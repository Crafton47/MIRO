import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/appError.js';
import { AuthenticatedUser } from '../types/index.js';

export async function ownDriver(user: AuthenticatedUser, driverId: string) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver || user.role !== 'DRIVER' || driver.userId !== user.userId) {
    throw new AppError('Driver access denied', 403, 'FORBIDDEN');
  }
  return driver;
}

export async function ownRide(user: AuthenticatedUser, rideId: string, driverOnly = false) {
  const ride = await prisma.ride.findUnique({ where: { id: rideId }, include: { driver: true } });
  const rider = user.role === 'RIDER' && ride?.riderId === user.userId;
  const driver = user.role === 'DRIVER' && ride?.driver?.userId === user.userId;
  if (!ride || !(driver || (!driverOnly && rider))) {
    throw new AppError('Ride access denied', 403, 'FORBIDDEN');
  }
  return ride;
}
