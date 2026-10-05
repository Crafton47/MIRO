import { Request, Response, NextFunction } from 'express';
import { rideService } from '../services/ride/ride.service.js';
import { fareService } from '../services/fare/fare.service.js';
import {
  estimateFareSchema,
  createRideSchema,
  acceptRideSchema,
  cancelRideSchema,
} from '../validators/ride.validator.js';

export class RideController {
  public estimateFare = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = estimateFareSchema.parse(req.body);
      const estimate = fareService.calculateFare(
        input.pickupLat,
        input.pickupLng,
        input.destLat,
        input.destLng
      );
      res.status(200).json({ success: true, data: estimate });
    } catch (error) {
      next(error);
    }
  };

  public createRide = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = createRideSchema.parse(req.body);
      const result = await rideService.createRide(input);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  public getRideById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ride = await rideService.getRideById(req.params.id);
      res.status(200).json({ success: true, data: ride });
    } catch (error) {
      next(error);
    }
  };

  public acceptRide = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { driverId } = acceptRideSchema.parse(req.body);
      const ride = await rideService.acceptRide(req.params.id, driverId);
      res.status(200).json({ success: true, data: ride });
    } catch (error) {
      next(error);
    }
  };

  public startRide = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ride = await rideService.startRide(req.params.id);
      res.status(200).json({ success: true, data: ride });
    } catch (error) {
      next(error);
    }
  };

  public completeRide = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ride = await rideService.completeRide(req.params.id);
      res.status(200).json({ success: true, data: ride });
    } catch (error) {
      next(error);
    }
  };

  public cancelRide = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { reason } = cancelRideSchema.parse(req.body || {});
      const ride = await rideService.cancelRide(req.params.id, reason);
      res.status(200).json({ success: true, data: ride });
    } catch (error) {
      next(error);
    }
  };
}

export const rideController = new RideController();
