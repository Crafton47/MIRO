import { h3Service } from '../h3/h3.service.js';
import { locationService } from '../location/location.service.js';
import { getRedisClient } from '../../config/redis.js';
import { prisma } from '../../config/prisma.js';
import { calculateHaversineDistance, estimateTravelTimeMinutes } from '../../utils/geo.js';
import { CandidateDriver } from '../../types/index.js';
import { env } from '../../config/env.js';
import { DriverStatus } from '@prisma/client';

export class MatchingService {
  /**
   * Find top N (default 8) nearest available drivers using H3 spatial indexing
   */
  public async findTopCandidateDrivers(
    pickupLat: number,
    pickupLng: number,
    maxDrivers = env.MAX_CANDIDATE_DRIVERS
  ): Promise<CandidateDriver[]> {
    const centerH3Cell = h3Service.latLngToCell(pickupLat, pickupLng);
    const redis = getRedisClient();

    // Expand search ring iteratively until we find candidate drivers or reach max ring radius
    const candidateDriverIds = new Set<string>();
    let kRingRadius = 0;
    const maxKRing = 4; // Up to 4 rings (~2.5km radius cover)

    while (candidateDriverIds.size < maxDrivers && kRingRadius <= maxKRing) {
      const surroundingCells = h3Service.getSurroundingCells(centerH3Cell, kRingRadius);
      for (const cell of surroundingCells) {
        const driversInCell: string[] = await redis.smembers(`h3:${cell}:drivers`);
        for (const dId of driversInCell) {
          candidateDriverIds.add(dId);
        }
      }
      kRingRadius++;
    }

    if (candidateDriverIds.size === 0) {
      return [];
    }

    // Fetch live positions & database metadata for candidates
    const candidateDetails: CandidateDriver[] = [];

    for (const driverId of candidateDriverIds) {
      const loc = await locationService.getDriverLocation(driverId);
      if (!loc || loc.status !== DriverStatus.ONLINE) continue;

      const distanceKm = calculateHaversineDistance(pickupLat, pickupLng, loc.latitude, loc.longitude);
      const etaMinutes = estimateTravelTimeMinutes(distanceKm);

      let driverRecord: any = null;
      if (process.env.NODE_ENV !== 'test') {
        try {
          driverRecord = await Promise.race([
            prisma.driver.findUnique({
              where: { id: driverId },
              include: { user: true, vehicle: true },
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('DB Timeout')), 300)),
          ]);
        } catch {
          // Soft fallback when database is slow or not connected
        }
      }

      candidateDetails.push({
        driverId: loc.driverId,
        userId: driverRecord?.userId || loc.driverId,
        driverName: driverRecord?.user?.name || `Driver ${loc.driverId.slice(0, 4)}`,
        rating: driverRecord?.rating || 5.0,
        latitude: loc.latitude,
        longitude: loc.longitude,
        distanceKm,
        etaMinutes,
        h3Index: loc.h3Index,
        vehicle: driverRecord?.vehicle
          ? {
              model: driverRecord.vehicle.model,
              numberPlate: driverRecord.vehicle.numberPlate,
              vehicleType: driverRecord.vehicle.vehicleType,
            }
          : undefined,
      });
    }

    // Sort candidate drivers by distance (and ETA)
    candidateDetails.sort((a, b) => a.distanceKm - b.distanceKm);

    // Return maximum N drivers (Top 8)
    return candidateDetails.slice(0, maxDrivers);
  }
}

export const matchingService = new MatchingService();
