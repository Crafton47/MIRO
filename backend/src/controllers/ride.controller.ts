import { locationService } from '../services/location/location.service.js';
import { Request, Response, NextFunction } from 'express';
import { rideService } from '../services/ride/ride.service.js';
import { fareService } from '../services/fare/fare.service.js';
import {
  estimateFareSchema,
  createRideSchema,
  acceptRideSchema,
  cancelRideSchema,
} from '../validators/ride.validator.js';

import { socketServer } from '../websocket/socket.server.js';

export class RideController {
  public activeRide = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ride = await rideService.getActiveRide(req.user!.userId);
      const location = ride?.driverId ? await locationService.getDriverLocation(ride.driverId).catch(() => null) : null;
      res.json({ success: true, data: ride, location: location && Date.now() - location.updatedAt < 60000 ? location : null });
    }
    catch (error) { next(error); }
  };

  public declineRide = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const driverId = req.authorizedDriverId!;
      const ride = await rideService.declineRide(req.params.id, driverId);
      socketServer.emitUnassigned(driverId, ride.id);
      socketServer.emitRide(ride);
      // The former driver must not receive the new driver's profile or trip updates.
      res.json({ success: true, data: { rideId: ride.id, released: true } });
    } catch (error) { next(error); }
  };

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

      socketServer.emitRide(result.ride);

      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  public getRideById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ride = await rideService.getRideById(req.params.id, req.authorizedDriverId);
      socketServer.emitRide(ride);
      res.status(200).json({ success: true, data: ride });
    } catch (error) {
      next(error);
    }
  };

  public acceptRide = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { driverId } = acceptRideSchema.parse(req.body);
      const ride = await rideService.acceptRide(req.params.id, driverId);
      socketServer.emitRide(ride);
      res.status(200).json({ success: true, data: ride });
    } catch (error) {
      next(error);
    }
  };

  public arriveRide = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ride = await rideService.arriveRide(req.params.id, req.authorizedDriverId);
      socketServer.emitRide(ride);
      res.status(200).json({ success: true, data: ride });
    } catch (error) {
      next(error);
    }
  };

  public startRide = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ride = await rideService.startRide(req.params.id, req.authorizedDriverId);
      socketServer.emitRide(ride);
      res.status(200).json({ success: true, data: ride });
    } catch (error) {
      next(error);
    }
  };

  public completeRide = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ride = await rideService.completeRide(req.params.id, req.authorizedDriverId);
      socketServer.emitRide(ride);
      res.status(200).json({ success: true, data: ride });
    } catch (error) {
      next(error);
    }
  };

  public cancelRide = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { reason } = cancelRideSchema.parse(req.body || {});
      const ride = await rideService.cancelRide(req.params.id, reason, req.authorizedDriverId);
      socketServer.emitRide(ride);
      res.status(200).json({ success: true, data: ride });
    } catch (error) {
      next(error);
    }
  };
}

export const rideController = new RideController();
