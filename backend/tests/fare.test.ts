import { fareService } from '../src/services/fare/fare.service';
import { calculateHaversineDistance } from '../src/utils/geo';

describe('FareService & Geo Utility Unit Tests', () => {
  test('calculateHaversineDistance should compute accurate distance in km', () => {
    // SF Downtown to Fisherman's Wharf (~3.5km)
    const dist = calculateHaversineDistance(37.7749, -122.4194, 37.808, -122.4177);
    expect(dist).toBeGreaterThan(3);
    expect(dist).toBeLessThan(4.5);
  });

  test('calculateFare should return correct base + distance + duration breakdown', () => {
    const pickupLat = 37.7749;
    const pickupLng = -122.4194;
    const destLat = 37.7833;
    const destLng = -122.4167;

    const result = fareService.calculateFare(pickupLat, pickupLng, destLat, destLng);

    expect(result.estimatedFare).toBeGreaterThanOrEqual(5.0); // Min fare
    expect(result.distanceKm).toBeGreaterThan(0);
    expect(result.durationMin).toBeGreaterThanOrEqual(1);
    expect(result.currency).toBe('USD');
  });
});
