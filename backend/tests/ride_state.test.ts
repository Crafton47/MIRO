import { rideService } from '../src/services/ride/ride.service';
import { RideStatus } from '@prisma/client';

describe('Ride State Machine Transition Tests', () => {
  test('rejects invalid state transition (COMPLETED -> REQUESTED)', async () => {
    // Access private validation via cast to test state machine enforcement
    const service = rideService as any;
    expect(() => {
      service.validateTransition(RideStatus.COMPLETED, RideStatus.REQUESTED);
    }).toThrow('Invalid ride state transition');
  });

  test('allows valid sequential transitions', async () => {
    const service = rideService as any;
    expect(() => {
      service.validateTransition(RideStatus.REQUESTED, RideStatus.DRIVER_ASSIGNED);
      service.validateTransition(RideStatus.DRIVER_ASSIGNED, RideStatus.DRIVER_ARRIVING);
      service.validateTransition(RideStatus.DRIVER_ARRIVING, RideStatus.DRIVER_ARRIVED);
      service.validateTransition(RideStatus.DRIVER_ARRIVED, RideStatus.IN_PROGRESS);
      service.validateTransition(RideStatus.IN_PROGRESS, RideStatus.COMPLETED);
    }).not.toThrow();
  });
});
