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
    if (
      typeof pickupLat !== 'number' ||
      typeof pickupLng !== 'number' ||
      !Number.isFinite(pickupLat) ||
      !Number.isFinite(pickupLng) || Math.abs(pickupLat) > 90 || Math.abs(pickupLng) > 180
    ) {
      return [];
    }

    const centerH3Cell = h3Service.latLngToCell(pickupLat, pickupLng);
    const redis = getRedisClient();

    // Expand search ring iteratively up to 8 rings (~5km radius cover)
    const candidateDriverIds = new Set<string>();
    let kRingRadius = 0;
    const maxKRing = 8;

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

    // Also include any online drivers recorded in Redis to ensure no online driver is missed
    const onlineDrivers: string[] = await redis.smembers('drivers:online');
    for (const dId of onlineDrivers) {
      candidateDriverIds.add(dId);
    }

    if (candidateDriverIds.size === 0) {
      return [];
    }

    // Fetch live positions & database metadata for candidates
    const candidateDetails: CandidateDriver[] = [];
    const now = Date.now();
    const STALE_THRESHOLD_MS = 60_000; // 60 seconds freshness window

    for (const driverId of candidateDriverIds) {
      const loc = await locationService.getDriverLocation(driverId);
      if (!loc || loc.status !== DriverStatus.ONLINE) continue;

      // Exclude invalid or default (0,0) coordinates
      if (loc.latitude === 0 && loc.longitude === 0) continue;
      if (!Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude) || Math.abs(loc.latitude) > 90 || Math.abs(loc.longitude) > 180) continue;
      if (loc.accuracy !== undefined && loc.accuracy > 100) continue;

      // Exclude stale location updates (> 60 seconds old)
      if (!loc.updatedAt || loc.updatedAt > now + 10_000 || now - loc.updatedAt > STALE_THRESHOLD_MS) {
        continue;
      }

      let driverRecord: any = null;
      {
        try {
          driverRecord = await prisma.driver.findUnique({
            where: { id: driverId },
            include: { user: { select: { name: true } }, vehicle: true, rides: { where: { status: { notIn: ['COMPLETED', 'CANCELLED'] } }, select: { id: true } } },
          });
          if (!driverRecord) continue;
          // Exclude drivers marked offline in DB or already assigned to an ongoing ride
          if (
            driverRecord &&
            (driverRecord.status !== DriverStatus.ONLINE || (driverRecord.rides && driverRecord.rides.length > 0))
          ) {
            continue;
          }
        } catch {
          continue; // Database eligibility must be confirmed.
        }
      }

      // Proximity calculated strictly relative to PICKUP coordinates
      const distanceKm = calculateHaversineDistance(pickupLat, pickupLng, loc.latitude, loc.longitude, false);
      const etaMinutes = estimateTravelTimeMinutes(distanceKm);

      candidateDetails.push({
        driverId: loc.driverId,
        userId: driverRecord?.userId || loc.driverId,
        driverName: driverRecord?.user?.name || `Driver ${loc.driverId.slice(0, 4)}`,
        rating: driverRecord?.rating || 4.9,
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

    // Sort candidate drivers strictly ascending by distance (and ETA)
    candidateDetails.sort((a, b) => a.distanceKm - b.distanceKm);

    // Return maximum N drivers (Top 8)
    return candidateDetails.slice(0, maxDrivers).map(candidate => ({ ...candidate, distanceKm: Math.round(candidate.distanceKm * 100) / 100 }));
  }
}

export const matchingService = new MatchingService();
