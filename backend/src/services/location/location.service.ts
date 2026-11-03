import { writeLocation } from './locationStore.js';
import { AppError } from '../../utils/appError.js';
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
    status?: DriverStatus
  ): Promise<DriverLocationData> {
    const redis = getRedisClient();
    const { driverId, latitude, longitude, heading = 0, speed = 0, accuracy, timestamp } = payload;

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      throw new AppError('Invalid coordinates', 400, 'INVALID_LOCATION');
    }
    if (timestamp !== undefined && (!Number.isFinite(timestamp) || timestamp > Date.now() + 10_000 || timestamp < Date.now() - 60_000)) {
      throw new AppError('Location timestamp is stale or in the future', 400, 'INVALID_TIMESTAMP');
    }
    // 1. Calculate H3 Index at configured resolution
    const h3Index = h3Service.latLngToCell(latitude, longitude);
    const fields = {
      driverId, latitude: String(latitude), longitude: String(longitude), h3Index,
      heading: String(heading), speed: String(speed), accuracy: accuracy === undefined ? '' : String(accuracy),
      status: status || '', updatedAt: String(timestamp || Date.now()),
    };
    const saved = await writeLocation(redis, driverId, fields);
    return this.decode(driverId, saved);
  }

  private decode(driverId: string, data: Record<string, string>): DriverLocationData {
    return {
      driverId, latitude: Number(data.latitude), longitude: Number(data.longitude), h3Index: data.h3Index,
      heading: Number(data.heading || 0), speed: Number(data.speed || 0),
      accuracy: data.accuracy ? Number(data.accuracy) : undefined,
      status: data.status as DriverStatus, updatedAt: Number(data.updatedAt),
    };
  }

  /**
   * Fetch live driver location from Redis
   */
  public async getDriverLocation(driverId: string): Promise<DriverLocationData | null> {
    const redis = getRedisClient();
    const data = await redis.hgetall(`driver:location:${driverId}`);
    if (!data || !data.latitude || !data.longitude) return null;

    return this.decode(driverId, data);
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
    await redis.srem('drivers:online', driverId);
    await redis.del(`driver:location:${driverId}`);
  }
}

export const locationService = new LocationService();
