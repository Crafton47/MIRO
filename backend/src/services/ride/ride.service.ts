import { logger } from '../../utils/logger.js';
import { prisma } from '../../config/prisma.js';
import { AppError } from '../../utils/appError.js';
import { fareService } from '../fare/fare.service.js';
import { matchingService } from '../matching/matching.service.js';
import { getRedisClient } from '../../config/redis.js';
import { CreateRideInput } from '../../validators/ride.validator.js';
import { Prisma, RideStatus, DriverStatus } from '@prisma/client';

export class RideService {
  private readonly validTransitions: Record<RideStatus, RideStatus[]> = {
    REQUESTED: [RideStatus.SEARCHING, RideStatus.DRIVER_ASSIGNED, RideStatus.CANCELLED],
    SEARCHING: [RideStatus.DRIVER_ASSIGNED, RideStatus.CANCELLED],
    DRIVER_ASSIGNED: [RideStatus.DRIVER_ARRIVING, RideStatus.DRIVER_ARRIVED, RideStatus.CANCELLED],
    DRIVER_ARRIVING: [RideStatus.DRIVER_ARRIVED, RideStatus.CANCELLED],
    DRIVER_ARRIVED: [RideStatus.IN_PROGRESS, RideStatus.CANCELLED],
    IN_PROGRESS: [RideStatus.COMPLETED, RideStatus.CANCELLED],
    COMPLETED: [],
    CANCELLED: [],
  };

  /**
   * Request a new ride
   */
  public async createRide(input: CreateRideInput) {
    const rider = await prisma.user.findUnique({ where: { id: input.riderId } });
    if (!rider) {
      throw new AppError('Rider user not found', 404, 'RIDER_NOT_FOUND');
    }

    // Calculate estimated fare & route metrics
    const fareEstimate = fareService.calculateFare(
      input.pickupLat,
      input.pickupLng,
      input.destLat,
      input.destLng
    );

    // Find top candidate drivers strictly ranked by pickup proximity
    const candidateDrivers = await matchingService.findTopCandidateDrivers(
      input.pickupLat,
      input.pickupLng
    );

    const { ride, assignedDriverId, assignedCandidate, rideStatus } = await this.serializable(async (tx) => {
      // Check if rider already has an active ride
      const activeRide = await tx.ride.findFirst({
        where: {
          riderId: input.riderId,
          status: {
            notIn: [RideStatus.COMPLETED, RideStatus.CANCELLED],
          },
        },
      });

      if (activeRide) {
        throw new AppError('Rider already has an active ride request', 400, 'ACTIVE_RIDE_EXISTS');
      }

      // Authoritative nearest driver assignment:
      // Select the closest eligible driver based on pickup proximity
      let assignedDriverId: string | null = null;
      let rideStatus: RideStatus = RideStatus.REQUESTED;
      let assignedCandidate: any = null;

      for (const candidate of candidateDrivers) {
        const updateResult = await tx.driver.updateMany({
          where: {
            id: candidate.driverId,
            status: DriverStatus.ONLINE,
          },
          data: {
            status: DriverStatus.IN_RIDE,
          },
        });

        if (updateResult.count > 0) {
          assignedDriverId = candidate.driverId;
          rideStatus = RideStatus.DRIVER_ASSIGNED;
          assignedCandidate = candidate;
          break;
        }
      }

      if (!assignedDriverId) throw new AppError('No available driver near pickup. Please try again.', 409, 'NO_DRIVER_AVAILABLE');
      const ride = await tx.ride.create({
        data: {
          riderId: input.riderId,
          driverId: assignedDriverId,
          status: rideStatus,
          pickupLat: input.pickupLat,
          pickupLng: input.pickupLng,
          destLat: input.destLat,
          destLng: input.destLng,
          pickupAddress: input.pickupAddress,
          destAddress: input.destAddress,
          distanceKm: fareEstimate.distanceKm,
          durationMin: fareEstimate.durationMin,
          estimatedFare: fareEstimate.estimatedFare,
        },
        include: {
          rider: {
            select: { id: true, name: true, phone: true },
          },
          driver: {
            include: {
              user: { select: { id: true, name: true, phone: true } },
              vehicle: true,
            },
          },
        },
      });

      return { ride, assignedDriverId, assignedCandidate, rideStatus };
    });

    try {
    // Save active state in Redis
    const redis = getRedisClient();
    await redis.hset(`ride:${ride.id}:state`, {
      rideId: ride.id,
      status: rideStatus,
      riderId: ride.riderId,
      driverId: assignedDriverId || '',
      pickupLat: String(ride.pickupLat),
      pickupLng: String(ride.pickupLng),
      updatedAt: String(Date.now()),
    });

    if (assignedDriverId) {
      await redis.hset(`driver:location:${assignedDriverId}`, 'status', DriverStatus.IN_RIDE);
      await redis.srem('drivers:online', assignedDriverId);
      const loc = await redis.hgetall(`driver:location:${assignedDriverId}`);
      if (loc?.h3Index) {
        await redis.srem(`h3:${loc.h3Index}:drivers`, assignedDriverId);
      }
    }

    } catch { logger.warn('Ride committed; location cache synchronization deferred'); }

    return {
      ride,
      candidateDrivers,
      assignedDriver: assignedCandidate,
      fareEstimate,
    };
  }

  /**
   * Get ride details by ID
   */
  public async getRideById(rideId: string, expectedDriverId?: string) {
    const ride = await prisma.ride.findUnique({
      where: { id: rideId, ...(expectedDriverId ? { driverId: expectedDriverId } : {}) },
      include: {
        rider: { select: { id: true, name: true, phone: true } },
        driver: {
          include: {
            user: { select: { id: true, name: true, phone: true } },
            vehicle: true,
          },
        },
      },
    });

    if (!ride) {
      throw new AppError('Ride not found', 404, 'RIDE_NOT_FOUND');
    }

    return ride;
  }

  /**
   * Driver accepts ride
   */
  public async acceptRide(rideId: string, driverId: string) {
    const ride = await this.getRideById(rideId);
    if (ride.driverId !== driverId) throw new AppError('Only the reserved driver can accept', 403, 'FORBIDDEN');
    this.validateTransition(ride.status, RideStatus.DRIVER_ARRIVING);
    const updatedRide = await prisma.ride.update({
      where: { id: rideId, status: RideStatus.DRIVER_ASSIGNED, driverId },
      data: { status: RideStatus.DRIVER_ARRIVING },
      include: { rider: { select: { id: true, name: true, phone: true } }, driver: { include: { user: { select: { id: true, name: true, phone: true } }, vehicle: true } } },
    });

    try {
    // Update Redis status & remove driver from available H3 candidate sets
    const redis = getRedisClient();
    await redis.hset(`ride:${rideId}:state`, {
      status: RideStatus.DRIVER_ARRIVING,
      driverId,
    });
    await redis.hset(`driver:location:${driverId}`, 'status', DriverStatus.IN_RIDE);
    const loc = await redis.hgetall(`driver:location:${driverId}`);
    if (loc?.h3Index) {
      await redis.srem(`h3:${loc.h3Index}:drivers`, driverId);
    }

    } catch { logger.warn('Ride committed; location cache synchronization deferred'); }

    return updatedRide;
  }

  /**
   * Driver arrives at pickup
   */
  public async arriveRide(rideId: string, expectedDriverId?: string) {
    const ride = await this.getRideById(rideId, expectedDriverId);
    if (
      ride.status === RideStatus.DRIVER_ASSIGNED ||
      ride.status === RideStatus.DRIVER_ARRIVING
    ) {
      // Valid transition
    } else {
      this.validateTransition(ride.status, RideStatus.DRIVER_ARRIVED);
    }

    const updatedRide = await prisma.ride.update({
      where: { id: rideId, status: ride.status, ...(expectedDriverId ? { driverId: expectedDriverId } : {}) },
      data: {
        status: RideStatus.DRIVER_ARRIVED,
      },
      include: {
        rider: { select: { id: true, name: true, phone: true } },
        driver: {
          include: {
            user: { select: { id: true, name: true, phone: true } },
            vehicle: true,
          },
        },
      },
    });

    try {
    const redis = getRedisClient();
    await redis.hset(`ride:${rideId}:state`, 'status', RideStatus.DRIVER_ARRIVED);

    } catch { logger.warn('Ride committed; location cache synchronization deferred'); }

    return updatedRide;
  }

  /**
   * Driver starts ride
   */
  public async startRide(rideId: string, expectedDriverId?: string) {
    const ride = await this.getRideById(rideId, expectedDriverId);

    this.validateTransition(ride.status, RideStatus.IN_PROGRESS);

    const updatedRide = await prisma.ride.update({
      where: { id: rideId, status: ride.status, ...(expectedDriverId ? { driverId: expectedDriverId } : {}) },
      data: {
        status: RideStatus.IN_PROGRESS,
        startedAt: new Date(),
      },
      include: {
        rider: { select: { id: true, name: true, phone: true } },
        driver: { include: { user: { select: { id: true, name: true, phone: true } }, vehicle: true } },
      },
    });

    try {
    const redis = getRedisClient();
    await redis.hset(`ride:${rideId}:state`, 'status', RideStatus.IN_PROGRESS);

    } catch { logger.warn('Ride committed; location cache synchronization deferred'); }

    return updatedRide;
  }

  /**
   * Driver completes ride
   */
  public async completeRide(rideId: string, expectedDriverId?: string) {
    const ride = await this.getRideById(rideId, expectedDriverId);
    this.validateTransition(ride.status, RideStatus.COMPLETED);

    const finalFareResult = fareService.calculateFare(
      ride.pickupLat,
      ride.pickupLng,
      ride.destLat,
      ride.destLng
    );

    const completedRide = await prisma.$transaction(async (tx) => {
      if (ride.driverId) {
        await tx.driver.update({
          where: { id: ride.driverId },
          data: { status: DriverStatus.ONLINE },
        });
      }

      return tx.ride.update({
        where: { id: rideId, status: ride.status, ...(expectedDriverId ? { driverId: expectedDriverId } : {}) },
        data: {
          status: RideStatus.COMPLETED,
          finalFare: finalFareResult.estimatedFare,
          completedAt: new Date(),
        },
        include: {
          rider: { select: { id: true, name: true, phone: true } },
          driver: { include: { user: { select: { id: true, name: true, phone: true } }, vehicle: true } },
        },
      });
    });

    try {
    // Update Redis state & restore driver availability in H3 set
    const redis = getRedisClient();
    await redis.hset(`ride:${rideId}:state`, 'status', RideStatus.COMPLETED);
    if (ride.driverId) {
      await redis.hset(`driver:location:${ride.driverId}`, 'status', DriverStatus.ONLINE);
      await redis.sadd('drivers:online', ride.driverId);
      const loc = await redis.hgetall(`driver:location:${ride.driverId}`);
      if (loc?.h3Index) {
        await redis.sadd(`h3:${loc.h3Index}:drivers`, ride.driverId);
      }
    }

    } catch { logger.warn('Ride committed; location cache synchronization deferred'); }

    return completedRide;
  }

  /**
   * Cancel ride
   */
  public async cancelRide(rideId: string, _reason?: string, expectedDriverId?: string) {
    const ride = await this.getRideById(rideId, expectedDriverId);
    this.validateTransition(ride.status, RideStatus.CANCELLED);

    const cancelledRide = await prisma.$transaction(async (tx) => {
      if (ride.driverId) {
        await tx.driver.update({
          where: { id: ride.driverId },
          data: { status: DriverStatus.ONLINE },
        });
      }

      return tx.ride.update({
        where: { id: rideId, status: ride.status, ...(expectedDriverId ? { driverId: expectedDriverId } : {}) },
        data: {
          status: RideStatus.CANCELLED,
          cancelledAt: new Date(),
        },
      });
    });

    try {
    const redis = getRedisClient();
    await redis.hset(`ride:${rideId}:state`, 'status', RideStatus.CANCELLED);
    if (ride.driverId) {
      await redis.hset(`driver:location:${ride.driverId}`, 'status', DriverStatus.ONLINE);
      await redis.sadd('drivers:online', ride.driverId);
      const loc = await redis.hgetall(`driver:location:${ride.driverId}`);
      if (loc?.h3Index) {
        await redis.sadd(`h3:${loc.h3Index}:drivers`, ride.driverId);
      }
    }

    } catch { logger.warn('Ride committed; location cache synchronization deferred'); }

    return cancelledRide;
  }

  /** Decline a pending offer and reserve the next eligible pickup-nearest driver. */
  public async declineRide(rideId: string, driverId: string) {
    const current = await this.getRideById(rideId);
    if (current.driverId !== driverId || current.status !== RideStatus.DRIVER_ASSIGNED) {
      throw new AppError('Only the current pending offer can be declined', 409, 'STATE_CONFLICT');
    }
    const redis = getRedisClient();
    const exclusionKey = `ride:${rideId}:declined`;
    // Required before re-dispatch: fail closed if offer history cannot be recorded.
    await redis.sadd(exclusionKey, driverId);
    await redis.expire(exclusionKey, 7 * 24 * 60 * 60);
    const excluded = new Set<string>(await redis.smembers(exclusionKey));
    const candidates = (await matchingService.findTopCandidateDrivers(current.pickupLat, current.pickupLng, 100))
      .filter(candidate => !excluded.has(candidate.driverId));
    const updated = await this.serializable(async tx => {
      let nextDriverId: string | null = null;
      for (const candidate of candidates) {
        const result = await tx.driver.updateMany({ where: { id: candidate.driverId, status: DriverStatus.ONLINE }, data: { status: DriverStatus.IN_RIDE } });
        if (result.count) { nextDriverId = candidate.driverId; break; }
      }
      // A concurrent accept/cancel/decline rolls back the new reservation too.
      const ride = await tx.ride.update({
        where: { id: rideId, driverId, status: RideStatus.DRIVER_ASSIGNED },
        data: { driverId: nextDriverId, status: nextDriverId ? RideStatus.DRIVER_ASSIGNED : RideStatus.CANCELLED, cancelledAt: nextDriverId ? null : new Date() },
        include: { rider: { select: { id: true, name: true, phone: true } }, driver: { include: { user: { select: { id: true, name: true, phone: true } }, vehicle: true } } },
      });
      await tx.driver.update({ where: { id: driverId }, data: { status: DriverStatus.ONLINE } });
      return ride;
    });
    try {
      for (const [id, status] of [[driverId, DriverStatus.ONLINE], [updated.driverId, DriverStatus.IN_RIDE]] as const) {
        if (!id) continue;
        const location = await redis.hgetall(`driver:location:${id}`);
        await redis.hset(`driver:location:${id}`, 'status', status);
        const operation = status === DriverStatus.ONLINE ? 'sadd' : 'srem';
        await redis[operation]('drivers:online', id);
        if (location.h3Index) await redis[operation](`h3:${location.h3Index}:drivers`, id);
      }
      await redis.hset(`ride:${rideId}:state`, { driverId: updated.driverId || '', status: updated.status });
    } catch { logger.warn('Re-dispatch committed; availability cache update failed'); }
    return updated;
  }

  public async getActiveRide(userId: string) {
    return prisma.ride.findFirst({
      where: { status: { notIn: [RideStatus.COMPLETED, RideStatus.CANCELLED] }, OR: [{ riderId: userId }, { driver: { userId } }] },
      orderBy: { createdAt: 'desc' },
      include: { rider: { select: { id: true, name: true, phone: true } }, driver: { include: { user: { select: { id: true, name: true, phone: true } }, vehicle: true } } },
    });
  }

  private async serializable<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error: any) { if (error.code !== 'P2034' || attempt >= 2) throw error; }
    }
  }

  /**
   * Enforce ride state machine transitions
   */
  private validateTransition(current: RideStatus, next: RideStatus): void {
    const allowed = this.validTransitions[current] || [];
    if (!allowed.includes(next)) {
      throw new AppError(
        `Invalid ride state transition from ${current} to ${next}`,
        400,
        'INVALID_STATE_TRANSITION'
      );
    }
  }
}

export const rideService = new RideService();
