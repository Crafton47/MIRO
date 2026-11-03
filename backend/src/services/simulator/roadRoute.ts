import { calculateHaversineDistance } from '../../utils/geo.js';

export type Point = { lat: number; lng: number };
export async function fetchDemoRoute(from: Point, to: Point): Promise<Point[]> {
  const origin = process.env.DEMO_ROUTING_URL || 'https://router.project-osrm.org';
  const response = await fetch(`${origin}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Demo routing unavailable');
  const data = await response.json() as any;
  const coordinates = data.routes?.[0]?.geometry?.coordinates;
  if (data.code !== 'Ok' || !Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > 100000) throw new Error('No demo road route');
  return coordinates.map((point: unknown) => {
    if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) throw new Error('Invalid road geometry');
    return { lat: point[1], lng: point[0] };
  });
}

// Used only for D2–D8, never for device GPS.
export function advanceOnRoad(position: Point, route: Point[], index: number, metres: number) {
  let current = { ...position };
  let heading = 0;
  while (index < route.length) {
    const target = route[index];
    const length = calculateHaversineDistance(current.lat, current.lng, target.lat, target.lng, false) * 1000;
    heading = (Math.atan2((target.lng - current.lng) * Math.cos(current.lat * Math.PI / 180), target.lat - current.lat) * 180 / Math.PI + 360) % 360;
    if (length > metres) {
      const fraction = metres / length;
      current = { lat: current.lat + (target.lat - current.lat) * fraction, lng: current.lng + (target.lng - current.lng) * fraction };
      return { ...current, index, heading, finished: false };
    }
    current = target; metres -= length; index++;
  }
  return { ...current, index, heading, finished: true };
}
