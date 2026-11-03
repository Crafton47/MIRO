import { logger } from '../../utils/logger.js';
import { prisma } from '../../config/prisma.js';
import { AppError } from '../../utils/appError.js';
import { getRedisClient } from '../../config/redis.js';
import { matchingService } from '../matching/matching.service.js';
import { CreateDriverInput } from '../../validators/driver.validator.js';
import { DriverStatus } from '@prisma/client';

export class DriverService {
  public async createDriver(input: CreateDriverInput) {
    const user = await prisma.user.findUnique({ where: { id: input.userId } });
    if (!user) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    const existingDriver = await prisma.driver.findUnique({ where: { userId: input.userId } });
    if (existingDriver) {
      throw new AppError('Driver profile already exists for this user', 400, 'DRIVER_EXISTS');
    }

    const driver = await prisma.driver.create({
      data: {
        userId: input.userId,
        status: DriverStatus.OFFLINE,
        vehicle: {
          create: {
            vehicleType: input.vehicleType,
            model: input.model,
            numberPlate: input.numberPlate,
          },
        },
      },
      include: {
        user: { select: { id: true, name: true, phone: true } },
        vehicle: true,
      },
    });

    return driver;
  }

  public async getDriverById(driverId: string) {
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      include: { user: { select: { id: true, name: true, phone: true } }, vehicle: true },
    });

    if (!driver) {
      throw new AppError('Driver not found', 404, 'DRIVER_NOT_FOUND');
    }

    return driver;
  }

  public async updateDriverStatus(driverId: string, status: DriverStatus) {
    const driver = await prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver) {
      throw new AppError('Driver not found', 404, 'DRIVER_NOT_FOUND');
    }

    if (driver.status === DriverStatus.IN_RIDE) {
      throw new AppError('Finish or cancel the current ride before changing availability', 409, 'DRIVER_BUSY');
    }
    const updatedDriver = await prisma.driver.update({
      where: { id: driverId, status: driver.status },
      data: { status },
      include: { vehicle: true },
    });

    try {
      // Sync status with Redis live location hash & H3 index set
      const redis = getRedisClient();
      const locationKey = `driver:location:${driverId}`;
      const locationData = await redis.hgetall(locationKey);

      if (locationData && locationData.h3Index) {
        await redis.hset(locationKey, 'status', status);
        if (status === DriverStatus.ONLINE) {
          await redis.sadd(`h3:${locationData.h3Index}:drivers`, driverId);
        } else {
          await redis.srem(`h3:${locationData.h3Index}:drivers`, driverId);
        }
      }

      if (status === DriverStatus.ONLINE) {
        await redis.sadd('drivers:online', driverId);
      } else {
        await redis.srem('drivers:online', driverId);
      }
    } catch {
      logger.warn('Driver status committed; location cache synchronization deferred');
    }

    return updatedDriver;
  }

  public async getNearbyDrivers(lat: number, lng: number, radiusKm = 5) {
    return (await matchingService.findTopCandidateDrivers(lat, lng, 8)).filter(driver => driver.distanceKm <= radiusKm);
  }
}

export const driverService = new DriverService();
