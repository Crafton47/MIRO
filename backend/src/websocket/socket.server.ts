import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { locationService } from '../services/location/location.service.js';
import { driverService } from '../services/driver/driver.service.js';
import { rideService } from '../services/ride/ride.service.js';
import {
  wsLocationEventSchema,
  wsStatusEventSchema,
  wsRideActionSchema,
} from '../validators/websocket.validator.js';
import { logger } from '../utils/logger.js';
import { DriverStatus } from '@prisma/client';

export class SocketServer {
  private io: Server | null = null;

  public init(httpServer: HttpServer): Server {
    this.io = new Server(httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    });

    this.io.on('connection', (socket: Socket) => {
      logger.info(`🔌 Client connected to WebSocket: ${socket.id}`);

      // Allow client to join rooms (e.g., driver room, ride room, rider room)
      socket.on('join', (room: string) => {
        socket.join(room);
        logger.info(`Socket ${socket.id} joined room: ${room}`);
      });

      // 1. Driver Location Update (High Frequency GPS Event)
      socket.on('driver:location', async (payload: unknown) => {
        try {
          const valid = wsLocationEventSchema.parse(payload);
          const locationData = await locationService.updateDriverLocation(valid);

          // Broadcast location update globally to all subscribers (riders, drivers, dashboard)
          this.io?.emit('location:update', {
            entityType: 'DRIVER',
            entityId: valid.driverId,
            ...locationData,
          });
        } catch (err: any) {
          socket.emit('error', { event: 'driver:location', message: err.message });
        }
      });

      // 2. Driver Online
      socket.on('driver:online', async (payload: unknown) => {
        try {
          const { driverId } = wsStatusEventSchema.parse(payload);
          await driverService.updateDriverStatus(driverId, DriverStatus.ONLINE);
          socket.join(`driver:${driverId}`);
          this.io?.emit('driver:status_changed', { driverId, status: DriverStatus.ONLINE });
        } catch (err: any) {
          socket.emit('error', { event: 'driver:online', message: err.message });
        }
      });

      // 3. Driver Offline
      socket.on('driver:offline', async (payload: unknown) => {
        try {
          const { driverId } = wsStatusEventSchema.parse(payload);
          await driverService.updateDriverStatus(driverId, DriverStatus.OFFLINE);
          this.io?.emit('driver:status_changed', { driverId, status: DriverStatus.OFFLINE });
        } catch (err: any) {
          socket.emit('error', { event: 'driver:offline', message: err.message });
        }
      });

      // 4. Ride Accepted
      socket.on('ride:accepted', async (payload: unknown) => {
        try {
          const { rideId, driverId } = wsRideActionSchema.parse(payload);
          if (!driverId) throw new Error('driverId is required to accept ride');

          const updatedRide = await rideService.acceptRide(rideId, driverId);

          this.io?.emit('ride:status_changed', {
            rideId,
            status: updatedRide.status,
            ride: updatedRide,
          });
        } catch (err: any) {
          socket.emit('error', { event: 'ride:accepted', message: err.message });
        }
      });

      // 5. Ride Started
      socket.on('ride:started', async (payload: unknown) => {
        try {
          const { rideId } = wsRideActionSchema.parse(payload);
          const updatedRide = await rideService.startRide(rideId);

          this.io?.emit('ride:status_changed', {
            rideId,
            status: updatedRide.status,
            ride: updatedRide,
          });
        } catch (err: any) {
          socket.emit('error', { event: 'ride:started', message: err.message });
        }
      });

      // 6. Ride Completed
      socket.on('ride:completed', async (payload: unknown) => {
        try {
          const { rideId } = wsRideActionSchema.parse(payload);
          const updatedRide = await rideService.completeRide(rideId);

          this.io?.emit('ride:status_changed', {
            rideId,
            status: updatedRide.status,
            ride: updatedRide,
          });
        } catch (err: any) {
          socket.emit('error', { event: 'ride:completed', message: err.message });
        }
      });

      // 7. Ride Cancelled
      socket.on('ride:cancelled', async (payload: unknown) => {
        try {
          const { rideId } = wsRideActionSchema.parse(payload);
          const updatedRide = await rideService.cancelRide(rideId);

          this.io?.emit('ride:status_changed', {
            rideId,
            status: updatedRide.status,
            ride: updatedRide,
          });
        } catch (err: any) {
          socket.emit('error', { event: 'ride:cancelled', message: err.message });
        }
      });

      socket.on('disconnect', () => {
        logger.info(`❌ Client disconnected: ${socket.id}`);
      });
    });

    return this.io;
  }

  public getIO(): Server {
    if (!this.io) {
      throw new Error('SocketServer has not been initialized');
    }
    return this.io;
  }
}

export const socketServer = new SocketServer();
