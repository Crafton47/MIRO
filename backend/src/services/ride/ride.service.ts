import { prisma } from '../../config/prisma.js';
import { AppError } from '../../utils/appError.js';
import { fareService } from '../fare/fare.service.js';
import { matchingService } from '../matching/matching.service.js';
import { getRedisClient } from '../../config/redis.js';
import { CreateRideInput } from '../../validators/ride.validator.js';
import { RideStatus, DriverStatus } from '@prisma/client';

export class RideService {
  private readonly validTransitions: Record<RideStatus, RideStatus[]> = {
    REQUESTED: [RideStatus.SEARCHING, RideStatus.DRIVER_ASSIGNED, RideStatus.CANCELLED],
    SEARCHING: [RideStatus.DRIVER_ASSIGNED, RideStatus.CANCELLED],
    DRIVER_ASSIGNED: [RideStatus.DRIVER_ARRIVING, RideStatus.CANCELLED],
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

    // Check if rider already has an active ride
    const activeRide = await prisma.ride.findFirst({
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

    // Calculate estimated fare & route metrics
    const fareEstimate = fareService.calculateFare(
      input.pickupLat,
      input.pickupLng,
      input.destLat,
      input.destLng
    );

    // Find top candidate drivers for notification
    const candidateDrivers = await matchingService.findTopCandidateDrivers(
      input.pickupLat,
      input.pickupLng
    );

    const ride = await prisma.ride.create({
      data: {
        riderId: input.riderId,
        status: RideStatus.REQUESTED,
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
      },
    });

    // Save active state in Redis
    const redis = getRedisClient();
    await redis.hset(`ride:${ride.id}:state`, {
      rideId: ride.id,
      status: RideStatus.REQUESTED,
      riderId: ride.riderId,
      pickupLat: String(ride.pickupLat),
      pickupLng: String(ride.pickupLng),
      updatedAt: String(Date.now()),
    });

    return {
      ride,
      candidateDrivers,
      fareEstimate,
    };
  }

  /**
   * Get ride details by ID
   */
  public async getRideById(rideId: string) {
    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
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
    this.validateTransition(ride.status, RideStatus.DRIVER_ASSIGNED);

    const driver = await prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver) {
      throw new AppError('Driver not found', 404, 'DRIVER_NOT_FOUND');
    }

    if (driver.status === DriverStatus.IN_RIDE) {
      throw new AppError('Driver is already handling another ride', 400, 'DRIVER_BUSY');
    }

    // Update ride & driver status in single transaction
    const updatedRide = await prisma.$transaction(async (tx) => {
      await tx.driver.update({
        where: { id: driverId },
        data: { status: DriverStatus.IN_RIDE },
      });

      return tx.ride.update({
        where: { id: rideId },
        data: {
          driverId,
          status: RideStatus.DRIVER_ASSIGNED,
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
    });

    // Update Redis status & remove driver from available H3 candidate sets
    const redis = getRedisClient();
    await redis.hset(`ride:${rideId}:state`, {
      status: RideStatus.DRIVER_ASSIGNED,
      driverId,
    });
    await redis.hset(`driver:location:${driverId}`, 'status', DriverStatus.IN_RIDE);
    const loc = await redis.hgetall(`driver:location:${driverId}`);
    if (loc?.h3Index) {
      await redis.srem(`h3:${loc.h3Index}:drivers`, driverId);
    }

    return updatedRide;
  }

  /**
   * Driver starts ride
   */
  public async startRide(rideId: string) {
    const ride = await this.getRideById(rideId);
    
    // Support transitioning directly from DRIVER_ASSIGNED, DRIVER_ARRIVING, or DRIVER_ARRIVED -> IN_PROGRESS
    if (ride.status === RideStatus.DRIVER_ASSIGNED || ride.status === RideStatus.DRIVER_ARRIVING || ride.status === RideStatus.DRIVER_ARRIVED) {
      // Valid transition
    } else {
      this.validateTransition(ride.status, RideStatus.IN_PROGRESS);
    }

    const updatedRide = await prisma.ride.update({
      where: { id: rideId },
      data: {
        status: RideStatus.IN_PROGRESS,
        startedAt: new Date(),
      },
      include: {
        rider: { select: { id: true, name: true, phone: true } },
        driver: { include: { user: true, vehicle: true } },
      },
    });

    const redis = getRedisClient();
    await redis.hset(`ride:${rideId}:state`, 'status', RideStatus.IN_PROGRESS);

    return updatedRide;
  }

  /**
   * Driver completes ride
   */
  public async completeRide(rideId: string) {
    const ride = await this.getRideById(rideId);
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
        where: { id: rideId },
        data: {
          status: RideStatus.COMPLETED,
          finalFare: finalFareResult.estimatedFare,
          completedAt: new Date(),
        },
        include: {
          rider: { select: { id: true, name: true, phone: true } },
          driver: { include: { user: true, vehicle: true } },
        },
      });
    });

    // Update Redis state & restore driver availability in H3 set
    const redis = getRedisClient();
    await redis.hset(`ride:${rideId}:state`, 'status', RideStatus.COMPLETED);
    if (ride.driverId) {
      await redis.hset(`driver:location:${ride.driverId}`, 'status', DriverStatus.ONLINE);
      const loc = await redis.hgetall(`driver:location:${ride.driverId}`);
      if (loc?.h3Index) {
        await redis.sadd(`h3:${loc.h3Index}:drivers`, ride.driverId);
      }
    }

    return completedRide;
  }

  /**
   * Cancel ride
   */
  public async cancelRide(rideId: string, _reason?: string) {
    const ride = await this.getRideById(rideId);
    this.validateTransition(ride.status, RideStatus.CANCELLED);

    const cancelledRide = await prisma.$transaction(async (tx) => {
      if (ride.driverId) {
        await tx.driver.update({
          where: { id: ride.driverId },
          data: { status: DriverStatus.ONLINE },
        });
      }

      return tx.ride.update({
        where: { id: rideId },
        data: {
          status: RideStatus.CANCELLED,
          cancelledAt: new Date(),
        },
      });
    });

    const redis = getRedisClient();
    await redis.hset(`ride:${rideId}:state`, 'status', RideStatus.CANCELLED);
    if (ride.driverId) {
      await redis.hset(`driver:location:${ride.driverId}`, 'status', DriverStatus.ONLINE);
      const loc = await redis.hgetall(`driver:location:${ride.driverId}`);
      if (loc?.h3Index) {
        await redis.sadd(`h3:${loc.h3Index}:drivers`, ride.driverId);
      }
    }

    return cancelledRide;
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
