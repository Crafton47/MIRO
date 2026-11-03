import request from 'supertest';
import app from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { getRedisClient } from '../src/config/redis.js';
import { rideService } from '../src/services/ride/ride.service.js';
import { matchingService } from '../src/services/matching/matching.service.js';
import { authService } from '../src/services/auth/auth.service.js';

const d1 = '00000000-0000-4000-a000-000000000001', d2 = '00000000-0000-4000-a000-000000000002';
const id = '33333333-3333-4000-a000-000000000001';
const offer = { id, driverId: d1, riderId: 'rider', status: 'DRIVER_ASSIGNED', pickupLat: 22, pickupLng: 88, driver: { userId: 'owner' } };
beforeEach(async () => { await getRedisClient().flushall(); });
afterEach(() => jest.restoreAllMocks());
function setup(candidates: string[]) {
  jest.spyOn(prisma.ride, 'findUnique').mockResolvedValue(offer as any);
  jest.spyOn(matchingService, 'findTopCandidateDrivers').mockResolvedValue(candidates.map(driverId => ({ driverId })) as any);
  const tx = {
    driver: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockResolvedValue({}) },
    ride: { update: jest.fn().mockImplementation(async ({ data }) => ({ ...offer, ...data })) },
  };
  jest.spyOn(prisma, '$transaction').mockImplementation(async (work: any) => work(tx));
  return tx;
}
test('decline reserves the nearest other driver and releases the old one in one transaction', async () => {
  const tx = setup([d1, d2]);
  const ride = await rideService.declineRide(id, d1);
  expect(ride.driverId).toBe(d2); expect(ride.status).toBe('DRIVER_ASSIGNED');
  expect(tx.driver.updateMany).toHaveBeenCalledTimes(1);
  expect(tx.driver.updateMany.mock.calls[0][0].where.id).toBe(d2);
  expect(tx.ride.update.mock.calls[0][0].where).toEqual({ id, driverId: d1, status: 'DRIVER_ASSIGNED' });
  expect(tx.driver.update).toHaveBeenCalledWith({ where: { id: d1 }, data: { status: 'ONLINE' } });
});
test('previous declines are excluded and exhaustion cancels rather than leaving a stranded ride', async () => {
  await getRedisClient().sadd(`ride:${id}:declined`, d2);
  const tx = setup([d2]);
  const ride = await rideService.declineRide(id, d1);
  expect(ride.status).toBe('CANCELLED'); expect(ride.driverId).toBeNull();
  expect(tx.driver.updateMany).not.toHaveBeenCalled();
});
test('wrong driver cannot decline an offer', async () => {
  const tx = setup([d2]);
  await expect(rideService.declineRide(id, d2)).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  expect(tx.ride.update).not.toHaveBeenCalled();
});
test('HTTP decline returns release only, not replacement profile', async () => {
  setup([d2]);
  const res = await request(app).post(`/api/v1/rides/${id}/decline`)
    .set('Authorization', `Bearer ${authService.generateToken('owner', 'owner@example.test', 'DRIVER')}`);
  expect(res.status).toBe(200); expect(res.body.data).toEqual({ rideId: id, released: true });
});
test('a delayed former-driver action carries the authorized driver into the write predicate', async () => {
  jest.spyOn(prisma.ride, 'findUnique').mockResolvedValue({ ...offer, driverId: d2, status: 'DRIVER_ARRIVING' } as any);
  const update = jest.spyOn(prisma.ride, 'update').mockRejectedValue({ code: 'P2025' });
  await expect(rideService.arriveRide(id, d1)).rejects.toMatchObject({ code: 'P2025' });
  expect(update.mock.calls[0][0].where).toEqual({ id, status: 'DRIVER_ARRIVING', driverId: d1 });
});
