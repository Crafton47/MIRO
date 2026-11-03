import { getEnv } from '../utils/constants.js';
/**
 * Real Road Routing Service using OSRM
 * 
 * Requests true road-following driving routes via OSRM.
 * Parses GeoJSON LineString coordinates, calculates bearing/heading,
 * and provides continuous distance-based interpolation for smooth vehicle animation.
 */

const DEFAULT_OSRM_URL = 'https://router.project-osrm.org';

class RoutingService {
  constructor() {
    this.baseUrl = getEnv('VITE_ROUTING_API_URL', DEFAULT_OSRM_URL);
    this.cache = new Map();
  }

  /**
   * Fetch a road-following driving route between start and end coordinates
   * @param {{ lat: number, lng: number }} start
   * @param {{ lat: number, lng: number }} end
   * @returns {Promise<{
   *   coordinates: Array<{ lat: number, lng: number }>,
   *   distanceMeters: number,
   *   distanceKm: number,
   *   durationSeconds: number,
   *   durationMin: number,
   *   summary: string,
   *   rawGeometry: object
   * }>}
   */
  async getDrivingRoute(start, end) {
    if (![start, end].every(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180)) {
      throw new Error('Invalid origin or destination coordinates supplied for routing.');
    }

    const startLat = parseFloat(Number(start.lat).toFixed(6));
    const startLng = parseFloat(Number(start.lng).toFixed(6));
    const endLat = parseFloat(Number(end.lat).toFixed(6));
    const endLng = parseFloat(Number(end.lng).toFixed(6));

    const cacheKey = `${startLng},${startLat};${endLng},${endLat}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // OSRM requires {longitude},{latitude};{longitude},{latitude}
    const url = `${this.baseUrl}/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson&steps=true`;

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Routing service returned HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
        throw new Error(data.message || 'No road route found between selected coordinates.');
      }

      const route = data.routes[0];
      const rawCoords = route.geometry?.coordinates || [];

      if (rawCoords.length < 2) {
        throw new Error('Routing geometry returned insufficient road coordinates.');
      }

      // GeoJSON is [lng, lat], convert to Leaflet-friendly { lat, lng }
      const coordinates = rawCoords.map((pt) => ({
        lat: parseFloat(pt[1].toFixed(6)),
        lng: parseFloat(pt[0].toFixed(6)),
      }));

      const distanceMeters = Math.round(route.distance || 0);
      const distanceKm = parseFloat((distanceMeters / 1000).toFixed(2));
      const durationSeconds = Math.round(route.duration || 0);
      const durationMin = Math.max(1, Math.round(durationSeconds / 60));
      const summary = route.legs?.[0]?.summary || 'Road Route';

      // Parse turn-by-turn road navigation steps
      const rawSteps = route.legs?.[0]?.steps || [];
      const steps = rawSteps.map((st, idx) => {
        const type = st.maneuver?.type || 'turn';
        const modifier = st.maneuver?.modifier || '';
        const streetName = st.name || '';
        let instruction = '';

        if (type === 'depart') {
          instruction = streetName ? `Head ${modifier ? modifier + ' ' : ''}on ${streetName}` : 'Depart towards route';
        } else if (type === 'arrive') {
          instruction = 'Arrive at destination';
        } else if (modifier.includes('left')) {
          instruction = streetName ? `Turn ${modifier} onto ${streetName}` : `Turn ${modifier}`;
        } else if (modifier.includes('right')) {
          instruction = streetName ? `Turn ${modifier} onto ${streetName}` : `Turn ${modifier}`;
        } else if (modifier.includes('uturn')) {
          instruction = streetName ? `Make a U-turn onto ${streetName}` : 'Make a U-turn';
        } else if (type === 'roundabout') {
          instruction = streetName ? `Enter roundabout to ${streetName}` : 'Enter roundabout';
        } else {
          instruction = streetName ? `Continue on ${streetName}` : 'Continue on route';
        }

        return {
          stepIndex: idx,
          instruction,
          streetName,
          distanceMeters: Math.round(st.distance || 0),
          durationSeconds: Math.round(st.duration || 0),
          type,
          modifier,
          location: st.maneuver?.location ? { lat: st.maneuver.location[1], lng: st.maneuver.location[0] } : null,
        };
      });

      const result = {
        coordinates,
        distanceMeters,
        distanceKm,
        durationSeconds,
        durationMin,
        summary,
        steps,
        rawGeometry: route.geometry,
      };

      if (this.cache.size > 30) {
        const first = this.cache.keys().next().value;
        this.cache.delete(first);
      }
      this.cache.set(cacheKey, result);

      return result;
    } catch (err) {
      console.error('OSRM route fetch failed:', err);
      throw err;
    }
  }

  /**
   * Calculate Haversine distance in meters between two lat/lng coordinates
   */
  haversineDistance(p1, p2) {
    const R = 6371000; // Earth radius in meters
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(p2.lat - p1.lat);
    const dLng = toRad(p2.lng - p1.lng);
    const lat1 = toRad(p1.lat);
    const lat2 = toRad(p2.lat);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Calculate initial bearing (0-360 degrees) from p1 to p2
   */
  calculateBearing(p1, p2) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const toDeg = (rad) => (rad * 180) / Math.PI;

    const lat1 = toRad(p1.lat);
    const lat2 = toRad(p2.lat);
    const dLng = toRad(p2.lng - p1.lng);

    const y = Math.sin(dLng) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

    const bearing = (toDeg(Math.atan2(y, x)) + 360) % 360;
    return Math.round(bearing);
  }

  /**
   * Build cumulative distances for a coordinate path
   * @param {Array<{ lat: number, lng: number }>} coordinates
   * @returns {{ cumulative: number[], totalDistance: number }}
   */
  buildPathMetrics(coordinates) {
    if (!coordinates || coordinates.length < 2) {
      return { cumulative: [0], totalDistance: 0 };
    }

    const cumulative = [0];
    let total = 0;

    for (let i = 0; i < coordinates.length - 1; i++) {
      const segDist = this.haversineDistance(coordinates[i], coordinates[i + 1]);
      total += segDist;
      cumulative.push(total);
    }

    return { cumulative, totalDistance: total };
  }

  /**
   * Interpolate a position along a road path at a specific distance from start
   * @param {Array<{ lat: number, lng: number }>} coordinates
   * @param {number[]} cumulativeDistances
   * @param {number} distanceMeters
   * @returns {{ lat: number, lng: number, heading: number, isFinished: boolean }}
   */
  interpolatePositionAtDistance(coordinates, cumulativeDistances, distanceMeters) {
    if (!coordinates || coordinates.length === 0) {
      return { lat: 0, lng: 0, heading: 0, isFinished: true };
    }
    if (coordinates.length === 1 || distanceMeters <= 0) {
      const heading = coordinates.length > 1 ? this.calculateBearing(coordinates[0], coordinates[1]) : 0;
      return { lat: coordinates[0].lat, lng: coordinates[0].lng, heading, isFinished: false };
    }

    const totalDistance = cumulativeDistances[cumulativeDistances.length - 1];
    if (distanceMeters >= totalDistance) {
      const last = coordinates[coordinates.length - 1];
      const prev = coordinates[coordinates.length - 2];
      const heading = this.calculateBearing(prev, last);
      return { lat: last.lat, lng: last.lng, heading, isFinished: true };
    }

    // Binary search or linear scan for the active road segment
    let segIdx = 0;
    while (segIdx < cumulativeDistances.length - 1 && cumulativeDistances[segIdx + 1] < distanceMeters) {
      segIdx++;
    }

    const startDist = cumulativeDistances[segIdx];
    const endDist = cumulativeDistances[segIdx + 1];
    const segLen = endDist - startDist;
    const t = segLen > 0 ? (distanceMeters - startDist) / segLen : 0;

    const p1 = coordinates[segIdx];
    const p2 = coordinates[segIdx + 1];

    const lat = p1.lat + t * (p2.lat - p1.lat);
    const lng = p1.lng + t * (p2.lng - p1.lng);
    const heading = this.calculateBearing(p1, p2);

    return {
      lat: parseFloat(lat.toFixed(6)),
      lng: parseFloat(lng.toFixed(6)),
      heading,
      isFinished: false,
    };
  }

  /**
   * Find closest point on route to a driver position
   * Returns distance in meters to route line. If >80m, driver is off-route.
   */
  findClosestPointOnRoute(currentPos, coordinates) {
    if (!coordinates || coordinates.length < 2) {
      return { distanceToRouteMeters: 0, closestSegmentIndex: 0, isOffRoute: false };
    }

    let minDistance = Infinity;
    let closestIndex = 0;

    let closestPoint = coordinates[0];
    // Project onto every segment, so sparse geometry does not cause false reroutes.
    const scale = Math.cos(currentPos.lat * Math.PI / 180);
    for (let i = 0; i < coordinates.length - 1; i++) {
      const a = coordinates[i], b = coordinates[i + 1];
      const dx = (b.lng - a.lng) * scale, dy = b.lat - a.lat;
      const px = (currentPos.lng - a.lng) * scale, py = currentPos.lat - a.lat;
      const lengthSquared = dx * dx + dy * dy;
      const t = lengthSquared ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared)) : 0;
      const point = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
      const d = this.haversineDistance(currentPos, point);
      if (d < minDistance) { minDistance = d; closestIndex = i; closestPoint = point; }
    }

    return {
      closestPoint,
      distanceToRouteMeters: Math.round(minDistance),
      closestSegmentIndex: closestIndex,
      isOffRoute: minDistance > 80, // >80m off route marks off-route
    };
  }

  /**
   * Calculate remaining distance in km and duration in minutes from current position along route
   */
  calculateRemainingProgress(currentPos, coordinates) {
    if (!coordinates || coordinates.length < 2) {
      return { remainingKm: 0, remainingMin: 1, isOffRoute: false };
    }

    const { distanceToRouteMeters, closestSegmentIndex, isOffRoute, closestPoint } = this.findClosestPointOnRoute(currentPos, coordinates);

    let remainingMeters = this.haversineDistance(closestPoint, coordinates[closestSegmentIndex + 1]);
    for (let i = closestSegmentIndex + 1; i < coordinates.length - 1; i++) {
      remainingMeters += this.haversineDistance(coordinates[i], coordinates[i + 1]);
    }

    const remainingKm = parseFloat((remainingMeters / 1000).toFixed(2));
    const remainingMin = Math.max(1, Math.round(remainingKm * 2.5));

    return {
      remainingKm,
      remainingMin,
      distanceToRouteMeters,
      closestSegmentIndex,
      isOffRoute,
    };
  }
}

export const routingService = new RoutingService();
