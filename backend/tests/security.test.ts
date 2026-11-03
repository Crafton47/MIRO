import request from 'supertest';
import app from '../src/app.js';
import { authService } from '../src/services/auth/auth.service.js';
import { prisma } from '../src/config/prisma.js';
import { rideService } from '../src/services/ride/ride.service.js';
import { locationService } from '../src/services/location/location.service.js';
import { driverService } from '../src/services/driver/driver.service.js';
import { registerSchema } from '../src/validators/auth.validator.js';
import { matchingService } from '../src/services/matching/matching.service.js';

const riderId = '11111111-1111-4000-a000-000000000001';
const userId = '22222222-2222-4000-a000-000000000001';
const driverId = '00000000-0000-4000-a000-000000000001';
const rideId = '33333333-3333-4000-a000-000000000001';
const token = (id: string, role: string) => `Bearer ${authService.generateToken(id, 'test@example.test', role)}`;
const ride = (status = 'DRIVER_ASSIGNED') => ({ id: rideId, riderId, driverId, status, pickupLat: 22.56, pickupLng: 88.35, destLat: 22.55, destLng: 88.34, driver: { id: driverId, userId }, estimatedFare: 100 });

afterEach(() => jest.restoreAllMocks());

describe('HTTP security boundaries', () => {
  test.each([
    ['post', '/api/v1/rides'], ['post', `/api/v1/rides/${rideId}/cancel`],
    ['get', `/api/v1/rides/${rideId}`], ['patch', `/api/v1/drivers/${driverId}/location`],
    ['patch', `/api/v1/drivers/${driverId}/status`], ['get', '/api/v1/rides/active'],
  ])('%s %s rejects missing credentials', async (method, path) => {
    expect((await (request(app) as any)[method](path).send({})).status).toBe(401);
  });
  test('public registration cannot grant administrator access', () => {
    expect(registerSchema.safeParse({ name: 'Test', email: 'test@example.test', phone: '1234567890', password: 'longpassword', role: 'ADMIN' }).success).toBe(false);
  });
  test('rider cannot forge creator identity', async () => {
    const res = await request(app).post('/api/v1/rides').set('Authorization', token(riderId, 'RIDER')).send({ riderId: userId });
    expect(res.status).toBe(403);
  });
  test('different rider cannot read or cancel ride', async () => {
    jest.spyOn(prisma.ride, 'findUnique').mockResolvedValue(ride() as any);
    for (const method of ['get', 'post']) {
      const path = `/api/v1/rides/${rideId}${method === 'post' ? '/cancel' : ''}`;
      const res = await (request(app) as any)[method](path).set('Authorization', token('other', 'RIDER')).send({});
      expect(res.status).toBe(403);
    }
  });
  test('driver cannot send location for another driver', async () => {
    jest.spyOn(prisma.driver, 'findUnique').mockResolvedValue({ id: driverId, userId } as any);
    const update = jest.spyOn(locationService, 'updateDriverLocation');
    const res = await request(app).patch(`/api/v1/drivers/${driverId}/location`).set('Authorization', token('other', 'DRIVER')).send({ latitude: 22, longitude: 88 });
    expect(res.status).toBe(403); expect(update).not.toHaveBeenCalled();
  });
  test('rider cannot start assigned ride', async () => {
    jest.spyOn(prisma.ride, 'findUnique').mockResolvedValue(ride() as any);
    expect((await request(app).post(`/api/v1/rides/${rideId}/start`).set('Authorization', token(riderId, 'RIDER'))).status).toBe(403);
  });
  test('invalid coordinates rejected for authenticated driver', async () => {
    jest.spyOn(prisma.driver, 'findUnique').mockResolvedValue({ id: driverId, userId, status: 'ONLINE' } as any);
    expect((await request(app).patch(`/api/v1/drivers/${driverId}/location`).set('Authorization', token(userId, 'DRIVER')).send({ latitude: 999, longitude: 88 })).status).toBe(400);
  });
});

describe('Ride workflow and concurrency guards (mocked persistence)', () => {
  test('creation reserves nearest candidate within serializable transaction', async () => {
    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ id: riderId } as any);
    jest.spyOn(matchingService, 'findTopCandidateDrivers').mockResolvedValue([{ driverId } as any]);
    const tx = { driver: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) }, ride: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue(ride()) } };
    const transaction = jest.spyOn(prisma, '$transaction').mockImplementation(async (fn: any) => fn(tx));
    const result = await rideService.createRide({ riderId, pickupLat: 22.56, pickupLng: 88.35, destLat: 22.55, destLng: 88.34, pickupAddress: 'Pickup', destAddress: 'Destination' });
    expect(result.ride.driverId).toBe(driverId);
    expect(tx.driver.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: driverId, status: 'ONLINE' } }));
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });
  test('different driver cannot claim reservation', async () => {
    jest.spyOn(prisma.ride, 'findUnique').mockResolvedValue(ride() as any);
    await expect(rideService.acceptRide(rideId, 'other-driver')).rejects.toMatchObject({ statusCode: 403 });
  });
  test('concurrent accept has one winner through conditional database write', async () => {
    jest.spyOn(prisma.ride, 'findUnique').mockResolvedValue(ride() as any);
    const update = jest.spyOn(prisma.ride, 'update');
    update.mockResolvedValueOnce(ride('DRIVER_ARRIVING') as any).mockRejectedValueOnce({ code: 'P2025' });
    const results = await Promise.allSettled([rideService.acceptRide(rideId, driverId), rideService.acceptRide(rideId, driverId)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: rideId, status: 'DRIVER_ASSIGNED', driverId } }));
  });
  test('cannot start before arriving', async () => {
    jest.spyOn(prisma.ride, 'findUnique').mockResolvedValue(ride() as any);
    await expect(rideService.startRide(rideId)).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
  });
  test.each([['arriveRide', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED'], ['startRide', 'DRIVER_ARRIVED', 'IN_PROGRESS']] as const)('%s uses expected current state', async (method, before, after) => {
    jest.spyOn(prisma.ride, 'findUnique').mockResolvedValue(ride(before) as any);
    const update = jest.spyOn(prisma.ride, 'update').mockResolvedValue(ride(after) as any);
    const result = await rideService[method](rideId);
    expect(result.status).toBe(after);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: rideId, status: before } }));
    expect(JSON.stringify(update.mock.calls)).not.toContain('"user":true');
  });
  test.each([['completeRide', 'IN_PROGRESS', 'COMPLETED'], ['cancelRide', 'DRIVER_ASSIGNED', 'CANCELLED']] as const)('%s releases driver transactionally', async (method, before, after) => {
    jest.spyOn(prisma.ride, 'findUnique').mockResolvedValue(ride(before) as any);
    const tx = { driver: { update: jest.fn().mockResolvedValue({}) }, ride: { update: jest.fn().mockResolvedValue(ride(after)) } };
    jest.spyOn(prisma, '$transaction').mockImplementation(async (fn: any) => fn(tx));
    expect((await rideService[method](rideId)).status).toBe(after);
    expect(tx.ride.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: rideId, status: before } }));
    expect(tx.driver.update).toHaveBeenCalledWith({ where: { id: driverId }, data: { status: 'ONLINE' } });
  });
  test('availability cannot override an active reservation', async () => {
    jest.spyOn(prisma.driver, 'findUnique').mockResolvedValue({ id: driverId, status: 'IN_RIDE' } as any);
    await expect(driverService.updateDriverStatus(driverId, 'ONLINE')).rejects.toMatchObject({ code: 'DRIVER_BUSY' });
  });
  test('future GPS timestamps cannot pin a location indefinitely', async () => {
    await expect(locationService.updateDriverLocation({ driverId, latitude: 22, longitude: 88, timestamp: Date.now() + 100000 })).rejects.toMatchObject({ code: 'INVALID_TIMESTAMP' });
  });
});
