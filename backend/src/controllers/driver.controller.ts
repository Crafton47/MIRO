import { Request, Response, NextFunction } from 'express';
import { driverService } from '../services/driver/driver.service.js';
import { locationService } from '../services/location/location.service.js';
import {
  createDriverSchema,
  updateStatusSchema,
  updateLocationSchema,
  nearbyDriversSchema,
} from '../validators/driver.validator.js';

export class DriverController {
  public createDriver = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = createDriverSchema.parse(req.body);
      const driver = await driverService.createDriver(input);
      res.status(201).json({ success: true, data: driver });
    } catch (error) {
      next(error);
    }
  };

  public getDriverById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const driver = await driverService.getDriverById(req.params.id);
      res.status(200).json({ success: true, data: driver });
    } catch (error) {
      next(error);
    }
  };

  public updateStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { status } = updateStatusSchema.parse(req.body);
      const driver = await driverService.updateDriverStatus(req.params.id, status);
      res.status(200).json({ success: true, data: driver });
    } catch (error) {
      next(error);
    }
  };

  public updateLocation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = updateLocationSchema.parse(req.body);
      const locationData = await locationService.updateDriverLocation({
        driverId: req.params.id,
        ...input,
      });
      res.status(200).json({ success: true, data: locationData });
    } catch (error) {
      next(error);
    }
  };

  public getNearbyDrivers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = nearbyDriversSchema.parse(req.query);
      const drivers = await driverService.getNearbyDrivers(query.latitude, query.longitude, query.radiusKm);
      res.status(200).json({ success: true, data: drivers });
    } catch (error) {
      next(error);
    }
  };
}

export const driverController = new DriverController();
