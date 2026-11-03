import { describe, test, expect, jest } from '@jest/globals';
import { locationService } from '../src/services/location/location.service.js';
import { wsLocationEventSchema } from '../src/validators/websocket.validator.js';
import { DriverStatus } from '@prisma/client';

describe('Phase 2 — Real GPS Packet Validation & Out-of-Order Rejection', () => {
  const driverId = '00000000-0000-4000-a000-000000000001';

  test('Accepts valid real GPS packet with accuracy and timestamp', async () => {
    const packetTime = Date.now();
    const result = await locationService.updateDriverLocation(
      {
        driverId,
        latitude: 22.5646,
        longitude: 88.3510,
        speed: 15.5,
        heading: 90,
        accuracy: 12.4,
        timestamp: packetTime,
      },
      DriverStatus.ONLINE
    );

    expect(result).toBeDefined();
    expect(result.latitude).toBe(22.5646);
    expect(result.longitude).toBe(88.3510);
    expect(result.accuracy).toBe(12.4);
    expect(result.updatedAt).toBe(packetTime);
  });

  test('Rejects out-of-order GPS packet when packet timestamp is older than current state', async () => {
    const initialTime = Date.now();

    // 1. Initial fresh update
    await locationService.updateDriverLocation(
      {
        driverId,
        latitude: 22.5646,
        longitude: 88.3510,
        speed: 10,
        heading: 0,
        accuracy: 10.0,
        timestamp: initialTime,
      },
      DriverStatus.ONLINE
    );

    // 2. Delayed/stale packet arriving with older timestamp (5 seconds earlier)
    const staleTime = initialTime - 5000;
    const staleResult = await locationService.updateDriverLocation(
      {
        driverId,
        latitude: 22.5000,
        longitude: 88.3000,
        speed: 0,
        heading: 0,
        accuracy: 8.0,
        timestamp: staleTime,
      },
      DriverStatus.ONLINE
    );

    // Should return existing state and NOT overwrite with stale coordinates
    expect(staleResult.latitude).toBe(22.5646);
    expect(staleResult.longitude).toBe(88.3510);
    expect(staleResult.updatedAt).toBe(initialTime);
  });

  test('Validates WebSocket location event schema with accuracy and timestamp', () => {
    const validPayload = {
      driverId,
      latitude: 22.5726,
      longitude: 88.3639,
      speed: 25.0,
      heading: 180,
      accuracy: 9.5,
      timestamp: Date.now(),
    };

    const parseResult = wsLocationEventSchema.safeParse(validPayload);
    expect(parseResult.success).toBe(true);
  });

  test('Rejects invalid coordinates and negative accuracy in WebSocket schema', () => {
    const invalidPayload = {
      driverId,
      latitude: 105.0, // Invalid latitude (>90)
      longitude: 88.3639,
      accuracy: -5.0, // Invalid negative accuracy
    };

    const parseResult = wsLocationEventSchema.safeParse(invalidPayload);
    expect(parseResult.success).toBe(false);
  });
});
