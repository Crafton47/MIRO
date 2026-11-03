import { OfferExpiryService } from '../src/services/matching/offerExpiry.service.js';
import { prisma } from '../src/config/prisma.js';
import { rideService } from '../src/services/ride/ride.service.js';
import { socketServer } from '../src/websocket/socket.server.js';

afterEach(() => jest.restoreAllMocks());
test('persisted pending offers older than 45 seconds are re-dispatched', async () => {
  const now = Date.now();
  const read = jest.spyOn(prisma.ride, 'findMany').mockResolvedValue([{ id: 'ride', driverId: 'driver' }] as any);
  const decline = jest.spyOn(rideService, 'declineRide').mockResolvedValue({ id: 'ride' } as any);
  const release = jest.spyOn(socketServer, 'emitUnassigned').mockImplementation(() => {});
  jest.spyOn(socketServer, 'emitRide').mockImplementation(() => {});
  await new OfferExpiryService().sweep(now);
  expect(read.mock.calls[0][0]?.where).toEqual({ status: 'DRIVER_ASSIGNED', updatedAt: { lt: new Date(now - 45000) } });
  expect(decline).toHaveBeenCalledWith('ride', 'driver');
  expect(release).toHaveBeenCalledWith('driver', 'ride', 'timeout');
});
test('an accept winning the expiry race does not emit an unassignment', async () => {
  jest.spyOn(prisma.ride, 'findMany').mockResolvedValue([{ id: 'ride', driverId: 'driver' }] as any);
  jest.spyOn(rideService, 'declineRide').mockRejectedValue({ code: 'STATE_CONFLICT' });
  const release = jest.spyOn(socketServer, 'emitUnassigned').mockImplementation(() => {});
  await new OfferExpiryService().sweep(); expect(release).not.toHaveBeenCalled();
});
