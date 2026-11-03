import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { locationService } from '../services/location/location.service.js';
import { driverService } from '../services/driver/driver.service.js';
import { rideService } from '../services/ride/ride.service.js';
import { authService } from '../services/auth/auth.service.js';
import { ownDriver, ownRide } from '../services/access.js';
import { prisma } from '../config/prisma.js';
import { corsOptions } from '../config/security.js';
import { wsLocationEventSchema, wsStatusEventSchema, wsRideActionSchema } from '../validators/websocket.validator.js';
import { DriverStatus } from '@prisma/client';
import { AuthenticatedUser } from '../types/index.js';

export class SocketServer {
  private io: Server | null = null;
  public init(httpServer: HttpServer): Server {
    this.io = new Server(httpServer, { cors: corsOptions, maxHttpBufferSize: 16_384 });
    this.io.use(async (socket, next) => {
      try {
        const user = authService.verifyToken(socket.handshake.auth?.token);
        const account = await prisma.user.findUnique({ where: { id: user.userId }, include: { driver: true } });
        if (!account || account.role !== user.role) throw new Error('Invalid account');
        socket.data.user = user;
        socket.data.driverId = account.driver?.id;
        next();
      } catch { next(new Error('Authentication required')); }
    });
    this.io.on('connection', (socket: Socket) => {
      const user = socket.data.user as AuthenticatedUser;
      socket.join(`rider:${user.userId}`);
      if (socket.data.driverId) socket.join(`driver:${socket.data.driverId}`);
      socket.join('riders');
      let count = 0;
      let windowStart = Date.now();
      const handle = (event: string, action: (payload: any) => Promise<void>) => {
        socket.on(event, async (payload) => {
          try {
            authService.verifyToken(socket.handshake.auth?.token);
            if (Date.now() - windowStart > 60_000) { windowStart = Date.now(); count = 0; }
            if (++count > 180) throw new Error('Rate limited');
            await action(payload);
          } catch {
            socket.emit('error', { event, message: 'Action rejected. Refresh your session and check ride status.' });
          }
        });
      };
      handle('join', async room => {
        if (typeof room !== 'string') throw new Error('Invalid room');
        if (room === 'riders' || room === `rider:${user.userId}` || (socket.data.driverId && room === `driver:${socket.data.driverId}`)) {
          await socket.join(room); return;
        }
        if (!room.startsWith('ride:')) throw new Error('Forbidden');
        await ownRide(user, room.slice(5));
        await socket.join(room);
      });
      handle('driver:location', async payload => {
        const valid = wsLocationEventSchema.parse(payload);
        const driver = await ownDriver(user, valid.driverId);
        if (driver.status === DriverStatus.OFFLINE) throw new Error('Driver offline');
        const location = await locationService.updateDriverLocation(valid, driver.status);
        await this.emitLocation(valid.driverId, location);
      });
      for (const [event, status] of [['driver:online', DriverStatus.ONLINE], ['driver:offline', DriverStatus.OFFLINE]] as const) {
        handle(event, async payload => {
          const { driverId } = wsStatusEventSchema.parse(payload);
          await ownDriver(user, driverId);
          await driverService.updateDriverStatus(driverId, status);
          this.io?.to(`driver:${driverId}`).emit('driver:status_changed', { driverId, status });
          this.io?.to('riders').emit('driver:status_changed', { driverId, status });
        });
      }
      for (const event of ['accepted', 'arrived', 'started', 'completed', 'cancelled'] as const) {
        handle(`ride:${event}`, async payload => {
          const { rideId, driverId } = wsRideActionSchema.parse(payload);
          const ride = await ownRide(user, rideId, event !== 'cancelled');
          if (event === 'accepted' && driverId !== ride.driverId) throw new Error('Forbidden');
          const updated = event === 'accepted' ? await rideService.acceptRide(rideId, driverId!)
            : event === 'arrived' ? await rideService.arriveRide(rideId, ride.driverId!)
            : event === 'started' ? await rideService.startRide(rideId, ride.driverId!)
            : event === 'completed' ? await rideService.completeRide(rideId, ride.driverId!)
            : await rideService.cancelRide(rideId, undefined, user.role === 'DRIVER' ? ride.driverId! : undefined);
          this.emitRide(updated);
        });
      }
      const timer = setTimeout(() => socket.disconnect(true), Math.max(1, ((user as any).exp * 1000 || Date.now()) - Date.now()));
      socket.on('disconnect', () => clearTimeout(timer));
    });
    return this.io;
  }
  public emitUnassigned(driverId: string, rideId: string, reason = 'declined') {
    this.io?.to(`driver:${driverId}`).emit('ride:unassigned', { rideId, reason });
  }

  public emitRide(ride: { id: string; riderId: string; driverId?: string | null; status: string }) {
    const rooms = [`rider:${ride.riderId}`];
    if (ride.driverId) rooms.push(`driver:${ride.driverId}`);
    this.io?.to(rooms).emit('ride:status_changed', { rideId: ride.id, status: ride.status, ride });
  }
  public async emitLocation(driverId: string, location: unknown) {
    const ride = await prisma.ride.findFirst({ where: { driverId, status: { notIn: ['COMPLETED', 'CANCELLED'] } } });
    const rooms = [`driver:${driverId}`];
    if (ride) {
      rooms.push(`rider:${ride.riderId}`);
    } else {
      rooms.push('riders');
    }
    this.io?.to(rooms).emit('location:update', { entityType: 'DRIVER', entityId: driverId, ...(location as object) });
  }
  public getIO(): Server {
    if (!this.io) throw new Error('SocketServer has not been initialized');
    return this.io;
  }
}
export const socketServer = new SocketServer();
