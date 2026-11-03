import { RequestHandler } from 'express';
import { ownDriver, ownRide } from '../services/access.js';
import { AppError } from '../utils/appError.js';

declare global { namespace Express { interface Request { authorizedDriverId?: string; } } }

export const driverOwner: RequestHandler = async (req, _res, next) => {
  try { await ownDriver(req.user!, req.params.id); next(); } catch (error) { next(error); }
};
export const rideOwner = (driverOnly = false): RequestHandler => async (req, _res, next) => {
  try {
    const ride = await ownRide(req.user!, req.params.id, driverOnly);
    if (req.path.endsWith('/accept') && req.body.driverId !== ride.driverId) {
      throw new AppError('Only the reserved driver can accept', 403, 'FORBIDDEN');
    }
    if (req.user!.role === 'DRIVER') req.authorizedDriverId = ride.driverId!;
    next();
  } catch (error) { next(error); }
};
export const riderIdentity: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== 'RIDER' || req.body.riderId !== req.user.userId) {
    return next(new AppError('Rider identity does not match session', 403, 'FORBIDDEN'));
  }
  next();
};
export const driverIdentity: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== 'DRIVER' || req.body.userId !== req.user.userId) {
    return next(new AppError('Driver identity does not match session', 403, 'FORBIDDEN'));
  }
  next();
};
