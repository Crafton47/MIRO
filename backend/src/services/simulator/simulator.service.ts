import { prisma } from '../../config/prisma.js';
import { demoEnabled } from '../../config/security.js';
import { AppError } from '../../utils/appError.js';
import { locationService } from '../location/location.service.js';
import { rideService } from '../ride/ride.service.js';
import { socketServer } from '../../websocket/socket.server.js';
import { logger } from '../../utils/logger.js';
import { DriverStatus } from '@prisma/client';
import { Point, fetchDemoRoute, advanceOnRoad } from './roadRoute.js';

type DemoDriver = Point & {
  heading: number;
  speedKmh: number;
  route?: Point[];
  index: number;
  legKey?: string;
  retryAt?: number;
};

export class DriverSimulatorService {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private generation = 0;
  private stepping = false;
  private drivers = new Map<string, DemoDriver>();
  private centerLat = process.env.CENTER_LAT ? parseFloat(process.env.CENTER_LAT) : 22.5646;
  private centerLng = process.env.CENTER_LNG ? parseFloat(process.env.CENTER_LNG) : 88.3510;
  private updateIntervalMs = 3000;

  constructor() {
    this.initDefaultDrivers();
  }

  private initDefaultDrivers() {
    this.drivers.clear();
    for (let i = 2; i <= 8; i++) {
      const angle = ((i - 2) * Math.PI * 2) / 7;
      this.drivers.set(`00000000-0000-4000-a000-00000000000${i}`, {
        lat: this.centerLat + Math.sin(angle) * 0.006,
        lng: this.centerLng + Math.cos(angle) * 0.006,
        heading: Math.round((angle * 180) / Math.PI),
        speedKmh: 30,
        index: 0,
      });
    }
  }

  public async publishInitialLocations() {
    for (const [driverId, state] of this.drivers.entries()) {
      try {
        const driver = await prisma.driver.findUnique({ where: { id: driverId } });
        if (!driver || driver.status === DriverStatus.OFFLINE) continue;
        const location = await locationService.updateDriverLocation(
          {
            driverId,
            latitude: state.lat,
            longitude: state.lng,
            heading: state.heading,
            speed: state.speedKmh,
            accuracy: 10,
            timestamp: Date.now(),
          },
          driver.status
        );
        await socketServer.emitLocation(driverId, location);
      } catch (err: any) {
        logger.warn(`Failed to publish initial location for ${driverId}: ${err.message}`);
      }
    }
  }

  public async start(centerLat = this.centerLat, centerLng = this.centerLng, updateIntervalMs = 3000) {
    if (!demoEnabled) {
      throw new AppError('Demo simulator disabled', 403, 'DEMO_DISABLED');
    }
    if (
      !Number.isFinite(centerLat) ||
      Math.abs(centerLat) > 85 ||
      !Number.isFinite(centerLng) ||
      Math.abs(centerLng) > 180 ||
      !Number.isInteger(updateIntervalMs) ||
      updateIntervalMs < 1000 ||
      updateIntervalMs > 60000
    ) {
      throw new AppError('Invalid simulator configuration', 400, 'INVALID_SIMULATOR_CONFIG');
    }
    if (this.isRunning) return;

    this.centerLat = centerLat;
    this.centerLng = centerLng;
    this.updateIntervalMs = updateIntervalMs;
    this.generation++;
    this.isRunning = true;
    this.initDefaultDrivers();

    await this.publishInitialLocations();
    await this.stepSimulation();
    if (this.isRunning) {
      this.timer = setInterval(() => void this.stepSimulation(), this.updateIntervalMs);
    }
  }

  public stop() {
    this.isRunning = false;
    this.generation++;
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = null;
  }

  public async stepSimulation() {
    if (!this.isRunning || this.stepping) return;
    this.stepping = true;
    const generation = this.generation;

    try {
      // Drivers are independent; tick overlap is prohibited and each tick has seven bounded tasks.
      await Promise.all(
        [...this.drivers].map(async ([driverId, state]) => {
          try {
            await this.stepDriver(driverId, state, generation);
          } catch {
            state.retryAt = Date.now() + 30000;
            logger.warn('Demo driver paused: route, database or location service unavailable');
          }
        })
      );
    } finally {
      this.stepping = false;
    }
  }

  private async stepDriver(driverId: string, state: DemoDriver, generation: number) {
    // Exact allowlist is defense in depth against ever moving D1.
    if (!/^00000000-0000-4000-a000-00000000000[2-8]$/.test(driverId)) return;
    if ((state.retryAt || 0) > Date.now()) return;

    const live = () => this.isRunning && generation === this.generation;
    const driver = await prisma.driver.findUnique({ where: { id: driverId } });
    if (!live() || !driver || driver.status === DriverStatus.OFFLINE) return;

    const ride = await prisma.ride.findFirst({ where: { driverId, status: { notIn: ['COMPLETED', 'CANCELLED'] } } });
    if (!live()) return;

    if (ride?.status === 'DRIVER_ASSIGNED') {
      socketServer.emitRide(await rideService.acceptRide(ride.id, driverId));
      return;
    }
    if (ride?.status === 'DRIVER_ARRIVED') {
      socketServer.emitRide(await rideService.startRide(ride.id, driverId));
      return;
    }

    const leg = ride?.status === 'IN_PROGRESS' ? 'destination' : 'pickup';
    if (ride && !['DRIVER_ARRIVING', 'IN_PROGRESS'].includes(ride.status)) return;

    const legKey = ride ? `${ride.id}:${leg}` : 'idle';
    const target = ride
      ? { lat: leg === 'pickup' ? ride.pickupLat : ride.destLat, lng: leg === 'pickup' ? ride.pickupLng : ride.destLng }
      : { lat: this.centerLat + (Math.random() - 0.5) * 0.015, lng: this.centerLng + (Math.random() - 0.5) * 0.015 };

    if (!state.route || state.legKey !== legKey) {
      const route = await fetchDemoRoute(state, target);
      if (!live()) return;
      // Demo origins may be snapped to the provider's road. Never applied to D1.
      state.route = route;
      state.index = 1;
      state.lat = route[0].lat;
      state.lng = route[0].lng;
      state.legKey = legKey;
    }

    const position = advanceOnRoad(state, state.route, state.index, (state.speedKmh * this.updateIntervalMs) / 3600);

    // Re-check after external routing; cancellation/reassignment must not be undone by an old tick.
    const latest = await prisma.ride.findFirst({ where: { driverId, status: { notIn: ['COMPLETED', 'CANCELLED'] } } });
    const latestDriver = await prisma.driver.findUnique({ where: { id: driverId } });
    if (!live() || !latestDriver || latestDriver.status === DriverStatus.OFFLINE || latest?.id !== ride?.id || latest?.status !== ride?.status) {
      state.route = undefined;
      return;
    }

    state.lat = position.lat;
    state.lng = position.lng;
    state.heading = position.heading;
    state.index = position.index;

    const location = await locationService.updateDriverLocation(
      { driverId, latitude: state.lat, longitude: state.lng, heading: state.heading, speed: state.speedKmh, timestamp: Date.now() },
      latestDriver.status
    );
    if (!live()) return;

    await socketServer.emitLocation(driverId, location);

    if (position.finished) {
      state.route = undefined;
      if (ride) {
        socketServer.emitRide(leg === 'pickup' ? await rideService.arriveRide(ride.id, driverId) : await rideService.completeRide(ride.id, driverId));
      }
    }
  }

  public getStatus() {
    return {
      isRunning: this.isRunning,
      driverCount: this.drivers.size,
      centerLat: this.centerLat,
      centerLng: this.centerLng,
      updateIntervalMs: this.updateIntervalMs,
      mode: 'ROAD_DEMO',
      drivers: [...this.drivers].map(([id, { lat, lng, heading, speedKmh }]) => ({ id, lat, lng, heading, speedKmh })),
    };
  }
}

export const driverSimulatorService = new DriverSimulatorService();
