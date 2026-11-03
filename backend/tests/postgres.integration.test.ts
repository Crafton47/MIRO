import { randomUUID } from 'crypto';

// Explicit opt-in only. This suite never uses the application's DATABASE_URL.
const testUrl = process.env.MIRO_TEST_DATABASE_URL;
if (testUrl) {
  const parsed = new URL(testUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || !/^\/miro_test_[a-z0-9_]+$/i.test(parsed.pathname)) {
    throw new Error('Integration tests require a local dedicated database named miro_test_*');
  }
}
const suite = testUrl ? describe : describe.skip;
suite('Live PostgreSQL transactions (explicit disposable database only)', () => {
  let prisma: any, service: any, locations: any, redis: any;
  beforeAll(() => {
    process.env.DATABASE_URL = testUrl!;
    prisma = require('../src/config/prisma.js').prisma;
    service = require('../src/services/ride/ride.service.js').rideService;
    locations = require('../src/services/location/location.service.js').locationService;
    redis = require('../src/config/redis.js').getRedisClient();
  });
  afterAll(async () => { await prisma?.$disconnect(); });
  jest.setTimeout(30000);

  async function fixture(driverCount: number) {
    // This is the test-only MemoryRedis adapter, not an external Redis instance.
    await redis.flushall();
    const users = [];
    for (let i = 0; i < driverCount + 2; i++) {
      const id = randomUUID();
      users.push(await prisma.user.create({ data: { id, name: 'Isolated integration fixture', email: `${id}@example.test`, phone: id, passwordHash: 'not-a-login-password', role: i < 2 ? 'RIDER' : 'DRIVER' } }));
    }
    const drivers = [];
    for (let i = 0; i < driverCount; i++) {
      const driver = await prisma.driver.create({ data: { userId: users[i + 2].id, status: 'ONLINE' } });
      await locations.updateDriverLocation({ driverId: driver.id, latitude: 22.56 + i * .001, longitude: 88.35 }, 'ONLINE');
      drivers.push(driver);
    }
    const input = (riderId: string) => ({ riderId, pickupLat: 22.56, pickupLng: 88.35, destLat: 22.55, destLng: 88.34, pickupAddress: 'Test pickup', destAddress: 'Test destination' });
    return { users, drivers, input };
  }
  test('concurrent requests for one driver produce one committed assignment', async () => {
    const { users, drivers, input } = await fixture(1);
    const results = await Promise.allSettled([service.createRide(input(users[0].id)), service.createRide(input(users[1].id))]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.ride.count({ where: { driverId: drivers[0].id } })).toBe(1);
  });
  test('concurrent requests from one rider do not reserve two drivers', async () => {
    const { users, drivers, input } = await fixture(2);
    const results = await Promise.allSettled([service.createRide(input(users[0].id)), service.createRide(input(users[0].id))]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.ride.count({ where: { riderId: users[0].id } })).toBe(1);
    expect(await prisma.driver.count({ where: { id: { in: drivers.map(driver => driver.id) }, status: 'IN_RIDE' } })).toBe(1);
  });
  test('full lifecycle persists and terminal ride cannot be cancelled', async () => {
    const { users, drivers, input } = await fixture(1);
    const { ride } = await service.createRide(input(users[0].id));
    await service.acceptRide(ride.id, drivers[0].id);
    await service.arriveRide(ride.id, drivers[0].id);
    await service.startRide(ride.id, drivers[0].id);
    await service.completeRide(ride.id, drivers[0].id);
    expect((await prisma.ride.findUnique({ where: { id: ride.id } })).status).toBe('COMPLETED');
    expect((await prisma.driver.findUnique({ where: { id: drivers[0].id } })).status).toBe('ONLINE');
    await expect(service.cancelRide(ride.id)).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
  });
});
