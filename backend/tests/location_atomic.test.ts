import request from 'supertest';
import app from '../src/app.js';
import { MemoryRedis, getRedisClient } from '../src/config/redis.js';
import { locationService } from '../src/services/location/location.service.js';
import { writeLocation, locationUpdateScript } from '../src/services/location/locationStore.js';
import { rideService } from '../src/services/ride/ride.service.js';
import { authService } from '../src/services/auth/auth.service.js';

afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('concurrent GPS packets retain newest location and only its H3 membership', async () => {
  const redis = getRedisClient(); await redis.flushall();
  const now = Date.now();
  const results = await Promise.all([
    locationService.updateDriverLocation({ driverId: 'ordering-test', latitude: 22.55, longitude: 88.35, timestamp: now - 1000 }, 'ONLINE'),
    locationService.updateDriverLocation({ driverId: 'ordering-test', latitude: 22.65, longitude: 88.45, timestamp: now }, 'ONLINE'),
    locationService.updateDriverLocation({ driverId: 'ordering-test', latitude: 22.45, longitude: 88.25, timestamp: now - 500 }, 'ONLINE'),
  ]);
  const current = await locationService.getDriverLocation('ordering-test');
  expect(current?.latitude).toBe(22.65); expect(current?.updatedAt).toBe(now);
  expect(await redis.smembers(`h3:${results[0].h3Index}:drivers`)).not.toContain('ordering-test');
  expect(await redis.smembers(`h3:${current!.h3Index}:drivers`)).toContain('ordering-test');
  expect(results[2].latitude).toBe(22.65);
});
test('newer busy location removes availability and clears previous accuracy when omitted', async () => {
  const redis = getRedisClient(); const now = Date.now();
  await locationService.updateDriverLocation({ driverId: 'busy-test', latitude: 22.55, longitude: 88.35, accuracy: 10, timestamp: now - 1 }, 'ONLINE');
  const saved = await locationService.updateDriverLocation({ driverId: 'busy-test', latitude: 22.55, longitude: 88.35, timestamp: now }, 'IN_RIDE');
  expect(saved.accuracy).toBeUndefined();
  expect(await redis.smembers('drivers:online')).not.toContain('busy-test');
  expect(await redis.smembers(`h3:${saved.h3Index}:drivers`)).not.toContain('busy-test');
});
test('real Redis adapter sends one script call and decodes its saved result', async () => {
  const redis = { eval: jest.fn().mockResolvedValue(['latitude', '22.6', 'updatedAt', '100']) };
  const saved = await writeLocation(redis, 'driver', { updatedAt: '100', status: 'ONLINE', latitude: '22.6' });
  expect(redis.eval).toHaveBeenCalledTimes(1);
  expect(redis.eval.mock.calls[0].slice(0, 6)).toEqual([locationUpdateScript, 1, 'driver:location:driver', 'driver', '100', 'ONLINE']);
  expect(saved).toEqual({ latitude: '22.6', updatedAt: '100' });
});
test('expired decline history is not revived by a later addition', async () => {
  jest.useFakeTimers(); const redis = new MemoryRedis();
  await redis.sadd('declines', 'old'); await redis.expire('declines', 1);
  jest.advanceTimersByTime(1001); await redis.sadd('declines', 'new');
  expect(await redis.smembers('declines')).toEqual(['new']);
});
test('memory cache expiry applies to hashes and scalar keys, and missing keys cannot expire', async () => {
  jest.useFakeTimers(); const redis = new MemoryRedis();
  await redis.hset('hash', 'field', 'value'); await redis.expire('hash', 1);
  await redis.set('key', 'value', 'EX', 1);
  expect(await redis.expire('missing', 1)).toBe(0);
  jest.advanceTimersByTime(1001);
  expect(await redis.hgetall('hash')).toEqual({}); expect(await redis.get('key')).toBeNull();
});
test('active ride restores from PostgreSQL when location cache is unavailable', async () => {
  jest.spyOn(rideService, 'getActiveRide').mockResolvedValue({ id: 'ride', driverId: 'driver', status: 'IN_PROGRESS' } as any);
  jest.spyOn(locationService, 'getDriverLocation').mockRejectedValue(new Error('cache unavailable'));
  const response = await request(app).get('/api/v1/rides/active').set('Authorization', `Bearer ${authService.generateToken('rider', 'rider@example.test', 'RIDER')}`);
  expect(response.status).toBe(200); expect(response.body.data.status).toBe('IN_PROGRESS'); expect(response.body.location).toBeNull();
});
