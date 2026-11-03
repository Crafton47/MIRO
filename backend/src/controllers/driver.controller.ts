import { socketServer } from '../websocket/socket.server.js';
import { ownDriver } from '../services/access.js';
import { AppError } from '../utils/appError.js';
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
      const driver = await ownDriver(req.user!, req.params.id);
      if (driver.status === 'OFFLINE') throw new AppError('Go online before sending location', 409, 'DRIVER_OFFLINE');
      const locationData = await locationService.updateDriverLocation({
        driverId: req.params.id,
        ...input,
      }, driver.status);
      await socketServer.emitLocation(req.params.id, locationData);
      res.status(200).json({ success: true, data: locationData });
    } catch (error) {
      next(error);
    }
  };

  public getNearbyDrivers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = nearbyDriversSchema.parse(req.query);
      const drivers = await driverService.getNearbyDrivers(query.latitude, query.longitude, query.radiusKm);
      res.status(200).json({ success: true, data: drivers.map(({ userId, h3Index, ...driver }) => ({ ...driver, latitude: Math.round(driver.latitude * 1000) / 1000, longitude: Math.round(driver.longitude * 1000) / 1000 })) });
    } catch (error) {
      next(error);
    }
  };
}

export const driverController = new DriverController();
