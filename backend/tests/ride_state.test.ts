import { describe, test, expect } from '@jest/globals';
import { rideService } from '../src/services/ride/ride.service.js';
import { RideStatus } from '@prisma/client';

describe('Ride State Machine Transition Tests', () => {
  test('rejects invalid state transition (COMPLETED -> REQUESTED)', () => {
    const service = rideService as any;
    expect(() => {
      service.validateTransition(RideStatus.COMPLETED, RideStatus.REQUESTED);
    }).toThrow('Invalid ride state transition');
  });

  test('allows valid sequential transitions', () => {
    const service = rideService as any;
    expect(() => {
      service.validateTransition(RideStatus.REQUESTED, RideStatus.DRIVER_ASSIGNED);
      service.validateTransition(RideStatus.DRIVER_ASSIGNED, RideStatus.DRIVER_ARRIVING);
      service.validateTransition(RideStatus.DRIVER_ARRIVING, RideStatus.DRIVER_ARRIVED);
      service.validateTransition(RideStatus.DRIVER_ARRIVED, RideStatus.IN_PROGRESS);
      service.validateTransition(RideStatus.IN_PROGRESS, RideStatus.COMPLETED);
    }).not.toThrow();
  });

  test('allows direct DRIVER_ASSIGNED to DRIVER_ARRIVED transition', () => {
    const service = rideService as any;
    expect(() => {
      service.validateTransition(RideStatus.DRIVER_ASSIGNED, RideStatus.DRIVER_ARRIVED);
    }).not.toThrow();
  });
});
