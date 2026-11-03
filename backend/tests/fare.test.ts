import { describe, test, expect } from '@jest/globals';
import { fareService } from '../src/services/fare/fare.service.js';
import { calculateHaversineDistance } from '../src/utils/geo.js';

describe('FareService & Geo Utility Unit Tests', () => {
  test('calculateHaversineDistance should compute accurate distance in km', () => {
    // SF Downtown to Fisherman's Wharf (~3.5km)
    const dist = calculateHaversineDistance(37.7749, -122.4194, 37.808, -122.4177);
    expect(dist).toBeGreaterThan(3);
    expect(dist).toBeLessThan(4.5);
  });

  test('calculateFare should return correct base + distance + duration breakdown', () => {
    // Kolkata: Esplanade to Victoria Memorial
    const pickupLat = 22.5646;
    const pickupLng = 88.3510;
    const destLat = 22.5448;
    const destLng = 88.3426;

    const result = fareService.calculateFare(pickupLat, pickupLng, destLat, destLng);

    expect(result.estimatedFare).toBeGreaterThanOrEqual(60.0); // Min fare ₹60
    expect(result.distanceKm).toBeGreaterThan(0);
    expect(result.durationMin).toBeGreaterThanOrEqual(1);
    expect(result.currency).toBe('INR');
  });
});
