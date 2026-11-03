jest.mock('../src/config/security.js', () => ({ demoEnabled: true, corsOptions: {} }));
import { DriverSimulatorService } from '../src/services/simulator/simulator.service.js';
import { prisma } from '../src/config/prisma.js';
import { rideService } from '../src/services/ride/ride.service.js';
import { locationService } from '../src/services/location/location.service.js';
import { socketServer } from '../src/websocket/socket.server.js';
import * as road from '../src/services/simulator/roadRoute.js';

const driverId = '00000000-0000-4000-a000-000000000002';
let simulator: DriverSimulatorService;
beforeEach(() => {
  simulator = new DriverSimulatorService();
  (simulator as any).isRunning = true;
  (simulator as any).drivers = new Map([[driverId, { lat: 22, lng: 88, speedKmh: 30, heading: 0, index: 0 }]]);
  jest.spyOn(prisma.driver, 'findUnique').mockResolvedValue({ id: driverId, status: 'ONLINE' } as any);
  jest.spyOn(socketServer, 'emitRide').mockImplementation(() => {});
  jest.spyOn(socketServer, 'emitLocation').mockResolvedValue();
});
afterEach(() => { simulator.stop(); jest.restoreAllMocks(); });
test('road interpolation consumes sub-10m segments without distance rounding', () => {
  const result = road.advanceOnRoad({ lat: 22, lng: 88 }, [{ lat: 22.00004, lng: 88 }], 0, 1);
  expect(result.finished).toBe(false); expect(result.lat).toBeGreaterThan(22); expect(result.lat).toBeLessThan(22.00004);
});
test('simulator refuses D1 even if accidentally inserted into its internal map', async () => {
  (simulator as any).drivers = new Map([['00000000-0000-4000-a000-000000000001', { lat: 22, lng: 88 }]]);
  await simulator.stepSimulation(); expect(prisma.driver.findUnique).not.toHaveBeenCalled();
});
test.each([['DRIVER_ASSIGNED', 'acceptRide'], ['DRIVER_ARRIVED', 'startRide']] as const)('demo %s advances using authoritative ride service', async (status, method) => {
  jest.spyOn(prisma.ride, 'findFirst').mockResolvedValue({ id: 'ride', driverId, status } as any);
  const action = jest.spyOn(rideService, method).mockResolvedValue({ id: 'ride' } as any);
  await simulator.stepSimulation(); expect(action).toHaveBeenCalledWith('ride', driverId);
});
test.each([['DRIVER_ARRIVING', 'arriveRide'], ['IN_PROGRESS', 'completeRide']] as const)('finishing demo %s road leg updates trip', async (status, method) => {
  jest.spyOn(prisma.ride, 'findFirst').mockResolvedValue({ id: 'ride', driverId, status, pickupLat: 22.00001, pickupLng: 88, destLat: 22.00001, destLng: 88 } as any);
  jest.spyOn(road, 'fetchDemoRoute').mockResolvedValue([{ lat: 22, lng: 88 }, { lat: 22.00001, lng: 88 }]);
  jest.spyOn(locationService, 'updateDriverLocation').mockResolvedValue({} as any);
  const action = jest.spyOn(rideService, method).mockResolvedValue({ id: 'ride' } as any);
  await simulator.stepSimulation(); expect(action).toHaveBeenCalledWith('ride', driverId);
});
test('route failure pauses movement instead of inventing a straight road', async () => {
  jest.spyOn(prisma.ride, 'findFirst').mockResolvedValue(null);
  jest.spyOn(road, 'fetchDemoRoute').mockRejectedValue(new Error('unavailable'));
  const update = jest.spyOn(locationService, 'updateDriverLocation');
  await simulator.stepSimulation(); expect(update).not.toHaveBeenCalled();
});
test('stopping during route fetch prevents the old tick publishing location', async () => {
  jest.spyOn(prisma.ride, 'findFirst').mockResolvedValue(null);
  jest.spyOn(road, 'fetchDemoRoute').mockImplementation(async () => { simulator.stop(); return [{ lat: 22, lng: 88 }, { lat: 22.01, lng: 88 }]; });
  const update = jest.spyOn(locationService, 'updateDriverLocation');
  await simulator.stepSimulation(); expect(update).not.toHaveBeenCalled();
});
