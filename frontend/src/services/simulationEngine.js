/**
 * State-Driven Driver Simulation Engine
 * 
 * Manages accurate road-following vehicle animations through the complete ride lifecycle:
 * 1. Ride Accepted -> Road route from Driver -> Pickup -> Auto-stop -> DRIVER_ARRIVED
 * 2. Ride Started -> Road route from Pickup -> Destination -> Auto-stop -> ARRIVED_AT_DESTINATION
 * 3. Cancelled/Completed -> Instant timer and animation cleanup
 */

import { store } from '../state/store.js';
import { routingService } from './routingService.js';
import { socketClient } from '../api/socket.js';
import { apiClient } from '../api/client.js';
import { mapManager } from '../map/mapManager.js';
import { toast } from '../utils/toast.js';
import { RIDE_STATUS, DEMO_USERS } from '../utils/constants.js';
import { gpsService } from './gpsService.js';

export const SIMULATION_PHASE = {
  IDLE: 'IDLE',
  DRIVING_TO_PICKUP: 'DRIVING_TO_PICKUP',
  ARRIVED_AT_PICKUP: 'ARRIVED_AT_PICKUP',
  DRIVING_TO_DESTINATION: 'DRIVING_TO_DESTINATION',
  ARRIVED_AT_DESTINATION: 'ARRIVED_AT_DESTINATION',
};

class SimulationEngine {
  constructor() {
    this.phase = SIMULATION_PHASE.IDLE;
    this.animationFrameId = null;
    this.runId = 0;
    this.currentRoute = null;
    this.currentMetrics = null;
    this.distanceTraveledMeters = 0;
    this.lastFrameTime = 0;
    this.lastSocketEmitTime = 0;

    // Demonstration speed: realistic ~45 km/h accelerated for demonstration
    // ~120-150 m/s enables a ~1-2km trip to animate cleanly over 10-15 seconds
    this.speedMultiplier = 2.5;
    this.baseSpeedKmh = 45;

    // Listen to active ride status transitions to stop or clean up
    store.subscribe('activeRide', (ride) => {
      if (!ride || ride.status === RIDE_STATUS.CANCELLED || ride.status === RIDE_STATUS.COMPLETED) {
        this.stop();
      }
    });
  }

  getPhase() {
    return this.phase;
  }

  isSimulating() {
    return (
      this.phase === SIMULATION_PHASE.DRIVING_TO_PICKUP ||
      this.phase === SIMULATION_PHASE.DRIVING_TO_DESTINATION
    );
  }

  /**
   * Stop all active animation loops and reset route timers immediately
   */
  stop() {
    this.runId++;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.phase = SIMULATION_PHASE.IDLE;
    this.currentRoute = null;
    this.currentMetrics = null;
    this.distanceTraveledMeters = 0;
    this.lastFrameTime = 0;
    mapManager.clearDriverNavigationLine();
  }

  /**
   * Start Leg 1: Driver Current Position -> Pickup
   * Called when driver accepts the ride
   */
  async startNavigationToPickup(driverLocation, pickup) {
    throw new Error('D1 requires genuine device GPS. Simulated movement is disabled.');
    this.stop();
    const currentRunId = ++this.runId;

    try {
      toast.info('Calculating real road route to pickup...');
      const route = await routingService.getDrivingRoute(
        { lat: driverLocation.lat, lng: driverLocation.lng },
        { lat: pickup.lat, lng: pickup.lng }
      );

      if (currentRunId !== this.runId) return; // Stale request cancelled

      this.currentRoute = route.coordinates;
      this.currentMetrics = routingService.buildPathMetrics(route.coordinates);
      this.distanceTraveledMeters = 0;
      this.phase = SIMULATION_PHASE.DRIVING_TO_PICKUP;

      // Draw road route from driver to pickup
      mapManager.drawDriverToPickupRoute(this.currentRoute);

      toast.info(`Navigating to pickup (${route.distanceKm} km via ${route.summary})...`);
      this.lastFrameTime = performance.now();
      this.animateLeg(currentRunId, 'pickup', pickup);
    } catch (err) {
      console.error('Failed to navigate to pickup:', err);
      toast.error(`Road routing failed: ${err.message}`);
      this.stop();
    }
  }

  /**
   * Start Leg 2: Pickup -> Destination
   * Called when driver starts the ride
   */
  async startNavigationToDestination(pickup, destination) {
    throw new Error('D1 requires genuine device GPS. Simulated movement is disabled.');
    this.stop();
    const currentRunId = ++this.runId;

    try {
      toast.info('Calculating road route to destination...');
      const route = await routingService.getDrivingRoute(
        { lat: pickup.lat, lng: pickup.lng },
        { lat: destination.lat, lng: destination.lng }
      );

      if (currentRunId !== this.runId) return;

      this.currentRoute = route.coordinates;
      this.currentMetrics = routingService.buildPathMetrics(route.coordinates);
      this.distanceTraveledMeters = 0;
      this.phase = SIMULATION_PHASE.DRIVING_TO_DESTINATION;

      // Draw primary journey road route on map
      mapManager.drawRoadRoute(this.currentRoute);

      toast.info(`Driving to destination (${route.distanceKm} km via ${route.summary})...`);
      this.lastFrameTime = performance.now();
      this.animateLeg(currentRunId, 'destination', destination);
    } catch (err) {
      console.error('Failed to navigate to destination:', err);
      toast.error(`Road routing to destination failed: ${err.message}`);
      this.stop();
    }
  }

  /**
   * Frame animation loop interpolating along road geometry
   */
  animateLeg(runId, targetType, targetCoords) {
    const loop = (timestamp) => {
      if (runId !== this.runId) return;

      const dtSeconds = Math.min(0.1, (timestamp - this.lastFrameTime) / 1000);
      this.lastFrameTime = timestamp;

      // Calculate speed in meters per second
      // Real 45 km/h = 12.5 m/s. With demo multiplier ~6x = 75 m/s
      const speedKmh = this.baseSpeedKmh * this.speedMultiplier;
      const speedMps = (speedKmh * 1000) / 3600;

      this.distanceTraveledMeters += speedMps * dtSeconds;

      const pos = routingService.interpolatePositionAtDistance(
        this.currentRoute,
        this.currentMetrics.cumulative,
        this.distanceTraveledMeters
      );

      const { currentUser } = store.getState();
      const driverId = currentUser.id || DEMO_USERS.driver1.id;

      // If real GPS is active for Driver 1, do NOT overwrite GPS position via simulation
      const gpsActive = gpsService.isActive();
      if (gpsActive && driverId === DEMO_USERS.driver1.id) {
        // GPS is driving the position — just advance the internal distance counter
        // and keep the loop running so we can detect arrival for UI state changes
        this.animationFrameId = requestAnimationFrame(loop);
        return;
      }

      store.setDriverLocation({
        lat: pos.lat,
        lng: pos.lng,
        heading: pos.heading,
        speed: speedKmh,
      });

      mapManager.updateSingleDriverPosition(driverId, pos.lat, pos.lng, pos.heading);

      // Throttled WebSocket broadcast (~1s interval)
      if (timestamp - this.lastSocketEmitTime > 800) {
        this.lastSocketEmitTime = timestamp;
        socketClient.emitDriverLocation({
          driverId,
          latitude: pos.lat,
          longitude: pos.lng,
          heading: pos.heading,
          speed: Math.round(speedKmh),
        });
      }

      // Check for completion of this leg
      if (pos.isFinished || this.distanceTraveledMeters >= this.currentMetrics.totalDistance) {
        this.finishLeg(runId, targetType, targetCoords);
        return;
      }

      this.animationFrameId = requestAnimationFrame(loop);
    };

    this.animationFrameId = requestAnimationFrame(loop);
  }

  /**
   * Handle completion of a leg
   */
  async finishLeg(runId, targetType, targetCoords) {
    if (runId !== this.runId) return;

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    const { currentUser, activeRide } = store.getState();
    const driverId = currentUser.id || '00000000-0000-4000-a000-000000000001';

    // Snap cleanly to exact target coordinates
    store.setDriverLocation({
      lat: targetCoords.lat,
      lng: targetCoords.lng,
      heading: 0,
      speed: 0,
    });
    mapManager.updateSingleDriverPosition(driverId, targetCoords.lat, targetCoords.lng, 0);

    // Final socket update at destination
    socketClient.emitDriverLocation({
      driverId,
      latitude: targetCoords.lat,
      longitude: targetCoords.lng,
      heading: 0,
      speed: 0,
    });

    if (targetType === 'pickup') {
      this.phase = SIMULATION_PHASE.ARRIVED_AT_PICKUP;
      mapManager.clearDriverNavigationLine();

      toast.success('Driver arrived at pickup! Ready for passenger boarding.');

      if (activeRide) {
        try {
          await apiClient.arriveRide(activeRide.id);
          socketClient.socket?.emit('ride:arrived', { rideId: activeRide.id });
        } catch {
          // Backend fallback
        }
        const updated = { ...activeRide, status: RIDE_STATUS.DRIVER_ARRIVED };
        store.setActiveRide(updated);
      }
    } else {
      this.phase = SIMULATION_PHASE.ARRIVED_AT_DESTINATION;
      toast.success('Arrived at destination! Complete trip to finish.');
    }
  }
}

export const simulationEngine = new SimulationEngine();
