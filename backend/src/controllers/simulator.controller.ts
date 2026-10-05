import { Request, Response, NextFunction } from 'express';
import { driverSimulatorService } from '../services/simulator/simulator.service.js';

export class SimulatorController {
  public start = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const centerLat = req.body.centerLat ? parseFloat(req.body.centerLat) : 37.7749;
      const centerLng = req.body.centerLng ? parseFloat(req.body.centerLng) : -122.4194;
      const intervalMs = req.body.intervalMs ? parseInt(req.body.intervalMs, 10) : 3000;

      await driverSimulatorService.start(centerLat, centerLng, intervalMs);
      res.status(200).json({
        success: true,
        message: '7-driver simulator started successfully',
        data: driverSimulatorService.getStatus(),
      });
    } catch (error) {
      next(error);
    }
  };

  public stop = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      driverSimulatorService.stop();
      res.status(200).json({
        success: true,
        message: 'Simulator stopped',
        data: driverSimulatorService.getStatus(),
      });
    } catch (error) {
      next(error);
    }
  };

  public getStatus = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(200).json({
        success: true,
        data: driverSimulatorService.getStatus(),
      });
    } catch (error) {
      next(error);
    }
  };
}

export const simulatorController = new SimulatorController();
