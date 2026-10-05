import { getRedisClient } from '../../config/redis.js';
import { h3Service } from '../h3/h3.service.js';
import { DriverLocationPayload, DriverLocationData } from '../../types/index.js';
import { DriverStatus } from '@prisma/client';

export class LocationService {
  /**
   * Update driver location in Redis and maintain H3 cell index mapping
   */
  public async updateDriverLocation(
    payload: DriverLocationPayload,
    status: DriverStatus = DriverStatus.ONLINE
  ): Promise<DriverLocationData> {
    const redis = getRedisClient();
    const { driverId, latitude, longitude, heading = 0, speed = 0 } = payload;

    // 1. Calculate H3 Index at configured resolution
    const h3Index = h3Service.latLngToCell(latitude, longitude);
    const locationKey = `driver:location:${driverId}`;

    // 2. Fetch existing stored location to check for H3 cell migration
    const existing = await redis.hgetall(locationKey);
    const previousH3 = existing?.h3Index;

    const locationData: DriverLocationData = {
      driverId,
      latitude,
      longitude,
      h3Index,
      heading,
      speed,
      status: (existing?.status as DriverStatus) || status,
      updatedAt: Date.now(),
    };

    // 3. Save current location hash in Redis
    await redis.hset(locationKey, {
      driverId,
      latitude: String(latitude),
      longitude: String(longitude),
      h3Index,
      heading: String(heading),
      speed: String(speed),
      status: locationData.status,
      updatedAt: String(locationData.updatedAt),
    });

    // 4. Update H3 mapping set if cell changed or driver newly registered
    if (previousH3 && previousH3 !== h3Index) {
      await redis.srem(`h3:${previousH3}:drivers`, driverId);
    }
    
    // Only add to available set if driver is ONLINE
    if (locationData.status === DriverStatus.ONLINE) {
      await redis.sadd(`h3:${h3Index}:drivers`, driverId);
    } else {
      await redis.srem(`h3:${h3Index}:drivers`, driverId);
    }

    return locationData;
  }

  /**
   * Fetch live driver location from Redis
   */
  public async getDriverLocation(driverId: string): Promise<DriverLocationData | null> {
    const redis = getRedisClient();
    const data = await redis.hgetall(`driver:location:${driverId}`);
    if (!data || !data.latitude || !data.longitude) return null;

    return {
      driverId,
      latitude: parseFloat(data.latitude),
      longitude: parseFloat(data.longitude),
      h3Index: data.h3Index,
      heading: parseFloat(data.heading || '0'),
      speed: parseFloat(data.speed || '0'),
      status: (data.status as DriverStatus) || DriverStatus.OFFLINE,
      updatedAt: parseInt(data.updatedAt || '0', 10),
    };
  }

  /**
   * Remove driver from Redis location & spatial index
   */
  public async removeDriver(driverId: string): Promise<void> {
    const redis = getRedisClient();
    const existing = await redis.hgetall(`driver:location:${driverId}`);
    if (existing?.h3Index) {
      await redis.srem(`h3:${existing.h3Index}:drivers`, driverId);
    }
    await redis.del(`driver:location:${driverId}`);
  }
}

export const locationService = new LocationService();
