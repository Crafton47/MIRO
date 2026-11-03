import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { writeLocation } from '../src/services/location/locationStore.js';

const testUrl = process.env.MIRO_TEST_REDIS_URL;
if (testUrl) {
  const url = new URL(testUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/[1-9]\d*$/.test(url.pathname)) {
    throw new Error('Redis tests require an explicitly selected local nonzero disposable Redis database');
  }
}
const integration = testUrl ? test : test.skip;
integration('live Redis Lua orders packets and migrates indexes atomically', async () => {
  const redis = new Redis(testUrl!, { maxRetriesPerRequest: 1, retryStrategy: () => null });
  const driver = `miro-test-${randomUUID()}`;
  const oldCell = `${driver}-old`, newCell = `${driver}-new`;
  const packet = (timestamp: string, cell: string) => ({ driverId: driver, latitude: '22.5', longitude: '88.3', heading: '0', speed: '0', accuracy: '10', status: 'ONLINE', h3Index: cell, updatedAt: timestamp });
  try {
    await redis.ping();
    await Promise.all([
      writeLocation(redis, driver, packet('100', oldCell)),
      writeLocation(redis, driver, packet('200', newCell)),
      writeLocation(redis, driver, packet('150', oldCell)),
    ]);
    const location = await redis.hgetall(`driver:location:${driver}`);
    expect(location.updatedAt).toBe('200'); expect(location.h3Index).toBe(newCell);
    expect(await redis.smembers(`h3:${oldCell}:drivers`)).not.toContain(driver);
    expect(await redis.smembers(`h3:${newCell}:drivers`)).toContain(driver);
  } finally {
    // Delete only uniquely owned fixture keys/membership, never flush the database.
    try {
      await redis.srem('drivers:online', driver);
      await redis.del(`driver:location:${driver}`, `h3:${oldCell}:drivers`, `h3:${newCell}:drivers`);
    } finally { redis.disconnect(); }
  }
}, 15000);
