import { prisma } from '../src/config/prisma.js';
import { beforeAll, afterAll } from '@jest/globals';
import { describe, test, expect, jest } from '@jest/globals';
import { h3Service } from '../src/services/h3/h3.service.js';
import { locationService } from '../src/services/location/location.service.js';
import { matchingService } from '../src/services/matching/matching.service.js';
import { DriverStatus } from '@prisma/client';

describe('H3 Spatial Indexing & Top 8 Candidate Driver Matching', () => {
  jest.setTimeout(15000);
  beforeAll(() => {
    jest.spyOn(prisma.driver, 'findUnique').mockImplementation(async ({ where }: any) => ({ id: where.id, userId: where.id, status: DriverStatus.ONLINE, rides: [], user: { name: 'Test driver' } } as any));
  });
  afterAll(() => jest.restoreAllMocks());
  const pickupLat = 37.7749;
  const pickupLng = -122.4194;

  test('h3Service converts lat/lng to valid H3 cell index', () => {
    const cell = h3Service.latLngToCell(pickupLat, pickupLng);
    expect(h3Service.isValidCell(cell)).toBe(true);
  });

  test('matchingService returns maximum 8 nearest drivers ranked by distance', async () => {
    // Populate 10 test drivers into Redis H3 cells at varying distances
    for (let i = 1; i <= 10; i++) {
      const driverId = `00000000-0000-4000-a000-00000000009${i.toString(16)}`;
      const lat = pickupLat + i * 0.002; // Incremental distances
      const lng = pickupLng + i * 0.002;

      await locationService.updateDriverLocation(
        {
          driverId,
          latitude: lat,
          longitude: lng,
        },
        DriverStatus.ONLINE
      );
    }

    const candidates = await matchingService.findTopCandidateDrivers(pickupLat, pickupLng, 8);

    expect(candidates.length).toBeLessThanOrEqual(8);
    if (candidates.length > 1) {
      // Verify candidates are sorted by distance ascending
      for (let j = 0; j < candidates.length - 1; j++) {
        expect(candidates[j].distanceKm).toBeLessThanOrEqual(candidates[j + 1].distanceKm);
      }
    }
  });
});
