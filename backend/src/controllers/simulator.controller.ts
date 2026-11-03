import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { driverSimulatorService } from '../services/simulator/simulator.service.js';

export class SimulatorController {
  public start = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { centerLat, centerLng, intervalMs } = z.object({
        centerLat: z.number().min(-85).max(85).default(22.5646),
        centerLng: z.number().min(-180).max(180).default(88.3510),
        intervalMs: z.number().int().min(1000).max(60000).default(3000),
      }).parse(req.body || {});

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
