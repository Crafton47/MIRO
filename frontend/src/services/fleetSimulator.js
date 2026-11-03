/**
 * Fleet Simulator — 7 Simulated Background Drivers (D2–D8)
 *
 * Maintains exactly 7 simulated vehicle markers that follow valid road-route
 * geometries continuously. Each driver loops through a route, fetches a new
 * one on completion, and broadcasts position updates via the existing socket
 * infrastructure.
 *
 * Rules:
 *  - IDs: d2..d8 match the backend simulator IDs (00000000-0000-4000-a000-00000000000X)
 *  - NEVER touches Driver 1 (00000000-0000-4000-a000-000000000001)
 *  - NEVER accepts, starts, completes, or cancels real rides
 *  - Each driver independently follows road geometry at realistic speeds
 *  - Runs entirely in the browser — complements the backend simulator
 */

import { mapManager } from '../map/mapManager.js';
import { socketClient } from '../api/socket.js';
import { DEFAULT_COORDS } from '../utils/constants.js';

const OSRM_BASE = 'https://router.project-osrm.org';

// 7 simulated driver IDs (D2–D8, matching backend simulator.service.ts)
const SIMULATED_IDS = [
  '00000000-0000-4000-a000-000000000002',
  '00000000-0000-4000-a000-000000000003',
  '00000000-0000-4000-a000-000000000004',
  '00000000-0000-4000-a000-000000000005',
  '00000000-0000-4000-a000-000000000006',
  '00000000-0000-4000-a000-000000000007',
  '00000000-0000-4000-a000-000000000008',
];

// Waypoints scattered around central Kolkata for simulated fleet (D2-D8)
const KOLKATA_WAYPOINTS = [
  { lat: 22.5646, lng: 88.3510 }, // Esplanade Metro / Dharmatala
  { lat: 22.5448, lng: 88.3426 }, // Victoria Memorial / Queens Way
  { lat: 22.5516, lng: 88.3524 }, // Park Street / Chowringhee
  { lat: 22.5726, lng: 88.3639 }, // Sealdah Railway Station
  { lat: 22.5838, lng: 88.3426 }, // Howrah Bridge / Station approach
  { lat: 22.5700, lng: 88.3480 }, // BBD Bagh (Dalhousie Square)
  { lat: 22.5360, lng: 88.3450 }, // Rabindra Sadan / Exide
  { lat: 22.5280, lng: 88.3650 }, // Ballygunge Phari
  { lat: 22.5580, lng: 88.3750 }, // Entally / CIT Road
  { lat: 22.5850, lng: 88.3650 }, // Rajabazar / APC Road
  { lat: 22.6000, lng: 88.3700 }, // Shyambazar Five-Point Crossing
  { lat: 22.5300, lng: 88.3300 }, // Alipore / National Library
];

function getRandomWaypoint(excludeLat, excludeLng) {
  const candidates = KOLKATA_WAYPOINTS.filter(
    (w) => Math.abs(w.lat - excludeLat) > 0.003 || Math.abs(w.lng - excludeLng) > 0.003
  );
  return candidates[Math.floor(Math.random() * candidates.length)] || KOLKATA_WAYPOINTS[0];
}

function haversine(p1, p2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(p2.lat - p1.lat);
  const dLng = toRad(p2.lng - p1.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(p1.lat)) * Math.cos(toRad(p2.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearing(p1, p2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const lat1 = toRad(p1.lat), lat2 = toRad(p2.lat);
  const dLng = toRad(p2.lng - p1.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

async function fetchRoute(from, to) {
  const url = `${OSRM_BASE}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error('No route');
    const coords = data.routes[0].geometry.coordinates.map((c) => ({ lat: c[1], lng: c[0] }));
    return coords;
  } catch (e) {
    // Fallback: straight line between points (3 intermediate steps)
    console.warn('[FleetSim] OSRM failed, using straight-line fallback:', e.message);
    return [from, to];
  }
}

class SimulatedDriver {
  constructor(id, startPos) {
    this.id = id;
    this.pos = { ...startPos };
    this.route = null;          // Array of {lat,lng}
    this.routeMetrics = null;   // {cumulative[], totalDistance}
    this.distanceTraveled = 0;
    this.speedKmh = 28 + Math.random() * 18; // 28–46 km/h
    this.heading = Math.random() * 360;
    this.animFrameId = null;
    this.lastFrame = 0;
    this.lastSocketEmit = 0;
    this.running = false;
    this.fetching = false;
  }

  buildMetrics(coords) {
    const cumulative = [0];
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      total += haversine(coords[i], coords[i + 1]);
      cumulative.push(total);
    }
    return { cumulative, totalDistance: total };
  }

  interpolate(distance) {
    const { cumulative } = this.routeMetrics;
    const coords = this.route;
    const total = cumulative[cumulative.length - 1];

    if (distance >= total) {
      const last = coords[coords.length - 1];
      const prev = coords[coords.length - 2] || last;
      return { ...last, heading: bearing(prev, last), finished: true };
    }

    let i = 0;
    while (i < cumulative.length - 1 && cumulative[i + 1] < distance) i++;
    const seg = cumulative[i + 1] - cumulative[i];
    const t = seg > 0 ? (distance - cumulative[i]) / seg : 0;
    const p1 = coords[i], p2 = coords[i + 1] || p1;
    return {
      lat: p1.lat + t * (p2.lat - p1.lat),
      lng: p1.lng + t * (p2.lng - p1.lng),
      heading: bearing(p1, p2),
      finished: false,
    };
  }

  async fetchNextRoute() {
    if (this.fetching) return;
    this.fetching = true;
    const dest = getRandomWaypoint(this.pos.lat, this.pos.lng);
    const coords = await fetchRoute(this.pos, dest);
    this.route = coords;
    this.routeMetrics = this.buildMetrics(coords);
    this.distanceTraveled = 0;
    this.fetching = false;
  }

  start() {
    this.running = true;
    this.lastFrame = performance.now();
    this.fetchNextRoute().then(() => {
      if (this.running) this._tick(performance.now());
    });
  }

  stop() {
    this.running = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  _tick(now) {
    if (!this.running) return;

    const dt = Math.min(0.2, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    if (!this.route || !this.routeMetrics) {
      this.animFrameId = requestAnimationFrame((t) => this._tick(t));
      return;
    }

    const speedMps = (this.speedKmh * 1000) / 3600;
    this.distanceTraveled += speedMps * dt;

    const pos = this.interpolate(this.distanceTraveled);
    this.pos = { lat: pos.lat, lng: pos.lng };
    this.heading = pos.heading;

    // Update map marker
    mapManager.updateSingleSimulatedDriver(this.id, pos.lat, pos.lng, pos.heading);

    // Throttled socket broadcast (~2s interval for simulated fleet)
    if (now - this.lastSocketEmit > 2000) {
      this.lastSocketEmit = now;
      socketClient.emitDriverLocation({
        driverId: this.id,
        latitude: pos.lat,
        longitude: pos.lng,
        heading: Math.round(pos.heading),
        speed: Math.round(this.speedKmh),
      });
    }

    if (pos.finished) {
      // Fetch new route from current position
      this.fetchNextRoute().then(() => {
        if (this.running) this._tick(performance.now());
      });
      return;
    }

    this.animFrameId = requestAnimationFrame((t) => this._tick(t));
  }
}

class FleetSimulator {
  constructor() {
    this.drivers = new Map();
    this.isRunning = false;
  }

  /**
   * Start the 7-driver front-end fleet simulation.
   * Spread initial positions around the center coordinates.
   */
  start(centerLat = DEFAULT_COORDS.center.lat, centerLng = DEFAULT_COORDS.center.lng) {
    if (this.isRunning) return;
    this.isRunning = true;

    SIMULATED_IDS.forEach((id, idx) => {
      // Spread drivers in a circle
      const angle = (idx / SIMULATED_IDS.length) * 2 * Math.PI;
      const radius = 0.004 + (idx % 3) * 0.003;
      const startPos = {
        lat: centerLat + Math.sin(angle) * radius,
        lng: centerLng + Math.cos(angle) * radius,
      };

      const driver = new SimulatedDriver(id, startPos);
      this.drivers.set(id, driver);
      driver.start();
    });

    console.info('[FleetSimulator] Started 7 simulated drivers (D2–D8)');
  }

  stop() {
    this.drivers.forEach((d) => d.stop());
    this.drivers.clear();
    this.isRunning = false;
    console.info('[FleetSimulator] Stopped');
  }

  isSimulatedDriver(driverId) {
    return SIMULATED_IDS.includes(driverId);
  }

  getDriverCount() {
    return this.drivers.size;
  }
}

export const fleetSimulator = new FleetSimulator();
export { SIMULATED_IDS };
