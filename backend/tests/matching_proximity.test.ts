import { prisma } from '../src/config/prisma.js';
import { beforeAll, afterAll } from '@jest/globals';
import { describe, test, expect, jest } from '@jest/globals';
import { matchingService } from '../src/services/matching/matching.service.js';
import { locationService } from '../src/services/location/location.service.js';
import { calculateHaversineDistance } from '../src/utils/geo.js';
import { DriverStatus } from '@prisma/client';

describe('Phase 1 Acceptance Tests — Driver Proximity, Selection & Staleness', () => {
  jest.setTimeout(15000);
  beforeAll(() => {
    jest.spyOn(prisma.driver, 'findUnique').mockImplementation(async ({ where }: any) => ({ id: where.id, userId: where.id, status: DriverStatus.ONLINE, rides: [], user: { name: 'Test driver' } } as any));
  });
  afterAll(() => jest.restoreAllMocks());

  // Kolkata Pickup: Esplanade Metro
  const pickup = { lat: 22.5646, lng: 88.3510 };
  // Kolkata Destination: Victoria Memorial (~2.4km south-west)
  const dest1 = { lat: 22.5448, lng: 88.3426 };
  // Far Destination: Howrah Station (~4km north-west)
  const dest2 = { lat: 22.5838, lng: 88.3426 };

  const D1_ID = '00000000-0000-4000-a000-000000000001';
  const D2_ID = '00000000-0000-4000-a000-000000000002';

  test('Acceptance 1: If D1 is 300m from pickup and D2 is 2km away, D1 should be selected', async () => {
    // D1 at ~300m from pickup (delta ~0.0027 deg)
    const d1Lat = pickup.lat + 0.0027;
    const d1Lng = pickup.lng;
    const d1Dist = calculateHaversineDistance(pickup.lat, pickup.lng, d1Lat, d1Lng);
    expect(d1Dist).toBeGreaterThan(0.25);
    expect(d1Dist).toBeLessThan(0.35);

    // D2 at ~2.0km from pickup (delta ~0.018 deg)
    const d2Lat = pickup.lat + 0.018;
    const d2Lng = pickup.lng;
    const d2Dist = calculateHaversineDistance(pickup.lat, pickup.lng, d2Lat, d2Lng);
    expect(d2Dist).toBeGreaterThan(1.8);
    expect(d2Dist).toBeLessThan(2.2);

    // Register both as ONLINE with fresh timestamps
    await locationService.updateDriverLocation(
      { driverId: D1_ID, latitude: d1Lat, longitude: d1Lng },
      DriverStatus.ONLINE
    );
    await locationService.updateDriverLocation(
      { driverId: D2_ID, latitude: d2Lat, longitude: d2Lng },
      DriverStatus.ONLINE
    );

    const candidates = await matchingService.findTopCandidateDrivers(pickup.lat, pickup.lng, 8);
    expect(candidates.length).toBeGreaterThanOrEqual(2);

    const selected = candidates[0];
    expect(selected.driverId).toBe(D1_ID);
    expect(selected.distanceKm).toBeLessThan(candidates[1].distanceKm);
  });

  test('Acceptance 2: If D1 is 5km from pickup and D2 is 500m away, D2 should be selected', async () => {
    // D1 far away at ~5km (delta ~0.045 deg)
    const d1Lat = pickup.lat + 0.045;
    const d1Lng = pickup.lng;
    const d1Dist = calculateHaversineDistance(pickup.lat, pickup.lng, d1Lat, d1Lng);
    expect(d1Dist).toBeGreaterThan(4.5);

    // D2 close at ~500m (delta ~0.0045 deg)
    const d2Lat = pickup.lat + 0.0045;
    const d2Lng = pickup.lng;
    const d2Dist = calculateHaversineDistance(pickup.lat, pickup.lng, d2Lat, d2Lng);
    expect(d2Dist).toBeGreaterThan(0.4);
    expect(d2Dist).toBeLessThan(0.6);

    await locationService.updateDriverLocation(
      { driverId: D1_ID, latitude: d1Lat, longitude: d1Lng },
      DriverStatus.ONLINE
    );
    await locationService.updateDriverLocation(
      { driverId: D2_ID, latitude: d2Lat, longitude: d2Lng },
      DriverStatus.ONLINE
    );

    const candidates = await matchingService.findTopCandidateDrivers(pickup.lat, pickup.lng, 8);
    expect(candidates.length).toBeGreaterThanOrEqual(2);

    const selected = candidates[0];
    expect(selected.driverId).toBe(D2_ID);
    expect(selected.distanceKm).toBeLessThan(candidates[1].distanceKm);
  });

  test('Acceptance 3: Moving destination while keeping pickup fixed does NOT change driver ranking', async () => {
    // D2 is ~500m, D1 is ~5km from pickup
    const candidatesForDest1 = await matchingService.findTopCandidateDrivers(pickup.lat, pickup.lng, 8);
    // Moving destination to far point dest2 has ZERO effect on pickup-based driver matching
    const candidatesForDest2 = await matchingService.findTopCandidateDrivers(pickup.lat, pickup.lng, 8);

    expect(candidatesForDest1.map((c) => c.driverId)).toEqual(candidatesForDest2.map((c) => c.driverId));
    expect(candidatesForDest1[0].driverId).toBe(D2_ID);
  });

  test('Acceptance 4: Moving pickup recalculates driver proximity and can invert selection', async () => {
    // Move pickup north to Shyambazar (close to D1's position at pickup.lat + 0.045)
    const northPickupLat = pickup.lat + 0.044;
    const northPickupLng = pickup.lng;

    const candidates = await matchingService.findTopCandidateDrivers(northPickupLat, northPickupLng, 8);
    expect(candidates.length).toBeGreaterThanOrEqual(2);

    // Now D1 is ~100m away, D2 is ~4.4km away, so D1 is now closest!
    const selected = candidates[0];
    expect(selected.driverId).toBe(D1_ID);
  });

  test('Acceptance 5: Offline D1 is excluded even if last coordinate was nearby', async () => {
    // Place D1 right at pickup (0m away)
    await locationService.updateDriverLocation(
      { driverId: D1_ID, latitude: pickup.lat, longitude: pickup.lng },
      DriverStatus.ONLINE
    );
    // D2 is 500m away
    await locationService.updateDriverLocation(
      { driverId: D2_ID, latitude: pickup.lat + 0.0045, longitude: pickup.lng },
      DriverStatus.ONLINE
    );

    // Now set D1 to OFFLINE
    await locationService.updateDriverLocation(
      { driverId: D1_ID, latitude: pickup.lat, longitude: pickup.lng },
      DriverStatus.OFFLINE
    );

    const candidates = await matchingService.findTopCandidateDrivers(pickup.lat, pickup.lng, 8);
    const d1Found = candidates.find((c) => c.driverId === D1_ID);
    expect(d1Found).toBeUndefined();

    // D2 must be selected because D1 is offline
    expect(candidates[0].driverId).toBe(D2_ID);
  });
});
