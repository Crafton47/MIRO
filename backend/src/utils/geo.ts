/**
  * Calculate straight-line distance between two coordinates in kilometers using Haversine formula
  */
export function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  rounded = true
): number {
  const R = 6371; // Earth radius in kilometers
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return rounded ? Math.round(R * c * 100) / 100 : R * c; // 2 decimal places
}

/**
 * Estimate travel time in minutes based on distance and average urban speed (default 30 km/h)
 */
export function estimateTravelTimeMinutes(distanceKm: number, averageSpeedKmh = 30): number {
  if (distanceKm <= 0) return 1;
  const hours = distanceKm / averageSpeedKmh;
  const minutes = Math.ceil(hours * 60);
  return Math.max(1, minutes);
}

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
