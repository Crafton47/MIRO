import { locationService } from '../location/location.service.js';
import { logger } from '../../utils/logger.js';
import { DriverStatus } from '@prisma/client';

export class DriverSimulatorService {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private drivers: Map<string, { lat: number; lng: number; heading: number; speedKmh: number }> = new Map();

  // Default demo center: San Francisco downtown / College Campus area
  private centerLat = 37.7749;
  private centerLng = -122.4194;
  private updateIntervalMs = 3000;

  constructor() {
    this.initDefaultDrivers();
  }

  private initDefaultDrivers(count = 7, centerLat = 37.7749, centerLng = -122.4194) {
    this.centerLat = centerLat;
    this.centerLng = centerLng;
    this.drivers.clear();

    // Generate 7 simulated drivers (D2..D8) surrounding center point in small circular radii
    for (let i = 2; i <= 1 + count; i++) {
      const driverId = `00000000-0000-4000-a000-00000000000${i}`;
      const angle = ((i - 2) * (2 * Math.PI)) / count;
      const radiusDeg = 0.005 + (i % 3) * 0.003; // ~500m to 1.5km spread

      const lat = centerLat + Math.sin(angle) * radiusDeg;
      const lng = centerLng + Math.cos(angle) * radiusDeg;
      const heading = Math.round((angle * 180) / Math.PI + 90) % 360;

      this.drivers.set(driverId, {
        lat,
        lng,
        heading,
        speedKmh: 20 + (i % 4) * 5, // 20 - 35 km/h
      });
    }
  }

  /**
   * Start the 7-driver simulator engine
   */
  public async start(centerLat = this.centerLat, centerLng = this.centerLng, updateIntervalMs = 3000) {
    if (this.isRunning) return;

    this.centerLat = centerLat;
    this.centerLng = centerLng;
    this.updateIntervalMs = updateIntervalMs;
    this.isRunning = true;

    this.initDefaultDrivers(7, centerLat, centerLng);

    logger.info(`🚀 Driver Simulator started with ${this.drivers.size} drivers around (${centerLat}, ${centerLng})`);

    // Initial positioning push
    await this.stepSimulation();

    // Recurring simulation tick
    this.timer = setInterval(async () => {
      await this.stepSimulation();
    }, this.updateIntervalMs);
  }

  /**
   * Stop simulator engine
   */
  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    logger.info('⏹️ Driver Simulator stopped');
  }

  /**
   * Perform one step of movement for all simulated drivers
   */
  public async stepSimulation() {
    for (const [driverId, state] of this.drivers.entries()) {
      // Advance driver position along heading direction
      const distanceMeters = (state.speedKmh * 1000 * (this.updateIntervalMs / 1000)) / 3600;
      const deltaLat = (distanceMeters / 111111) * Math.cos((state.heading * Math.PI) / 180);
      const deltaLng =
        (distanceMeters / (111111 * Math.cos((state.lat * Math.PI) / 180))) *
        Math.sin((state.heading * Math.PI) / 180);

      state.lat += deltaLat;
      state.lng += deltaLng;

      // Slight heading curvature for natural movement
      state.heading = (state.heading + (Math.random() > 0.5 ? 2 : -2) + 360) % 360;

      // Ingest location update through EXACT same backend location pipeline as real drivers
      await locationService.updateDriverLocation(
        {
          driverId,
          latitude: state.lat,
          longitude: state.lng,
          heading: state.heading,
          speed: state.speedKmh,
          timestamp: Date.now(),
        },
        DriverStatus.ONLINE
      );
    }
  }

  public getStatus() {
    return {
      isRunning: this.isRunning,
      driverCount: this.drivers.size,
      centerLat: this.centerLat,
      centerLng: this.centerLng,
      updateIntervalMs: this.updateIntervalMs,
      drivers: Array.from(this.drivers.entries()).map(([id, data]) => ({ id, ...data })),
    };
  }
}

export const driverSimulatorService = new DriverSimulatorService();
