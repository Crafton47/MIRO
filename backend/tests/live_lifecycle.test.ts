import http from 'http';
import { randomUUID } from 'crypto';
import { io, Socket } from 'socket.io-client';
import app from '../src/app.js';
import { socketServer } from '../src/websocket/socket.server.js';
import { authService } from '../src/services/auth/auth.service.js';
import { prisma } from '../src/config/prisma.js';
import { getRedisClient } from '../src/config/redis.js';
import { locationService } from '../src/services/location/location.service.js';
import { matchingService } from '../src/services/matching/matching.service.js';
import { offerExpiryService } from '../src/services/matching/offerExpiry.service.js';
import { rideService } from '../src/services/ride/ride.service.js';
import { RideStatus, DriverStatus } from '@prisma/client';

const waitEvent = (socket: Socket, event: string, timeout = 4000) =>
  new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeout);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

describe('Live Full-Stack Lifecycle & H3 Proximity Tests', () => {
  let server: http.Server;
  let sockets: Socket[] = [];
  let port: number;
  let serverUrl: string;
  let redis: any;

  // Test identities
  let riderUser: any;
  let d1User: any;
  let d1Driver: any;
  let d2User: any;
  let d2Driver: any;

  let riderToken: string;
  let d1Token: string;
  let d2Token: string;

  beforeAll(async () => {
    redis = getRedisClient();

    // Create unique test users and driver records in the database
    const ts = Date.now();
    riderUser = await prisma.user.create({
      data: {
        id: randomUUID(),
        name: 'Live E2E Rider',
        email: `rider_e2e_${ts}@test.local`,
        phone: `+91910${String(ts).slice(-7)}`,
        passwordHash: 'not-a-login-hash',
        role: 'RIDER',
      },
    });

    d1User = await prisma.user.create({
      data: {
        id: randomUUID(),
        name: 'Live Real Driver D1',
        email: `driver1_e2e_${ts}@test.local`,
        phone: `+91911${String(ts).slice(-7)}`,
        passwordHash: 'not-a-login-hash',
        role: 'DRIVER',
      },
    });

    d1Driver = await prisma.driver.create({
      data: {
        id: randomUUID(),
        userId: d1User.id,
        status: DriverStatus.ONLINE,
      },
    });

    d2User = await prisma.user.create({
      data: {
        id: randomUUID(),
        name: 'Live Simulated Driver D2',
        email: `driver2_e2e_${ts}@test.local`,
        phone: `+91912${String(ts).slice(-7)}`,
        passwordHash: 'not-a-login-hash',
        role: 'DRIVER',
      },
    });

    d2Driver = await prisma.driver.create({
      data: {
        id: randomUUID(),
        userId: d2User.id,
        status: DriverStatus.ONLINE,
      },
    });

    riderToken = authService.generateToken(riderUser.id, riderUser.email, 'RIDER');
    d1Token = authService.generateToken(d1User.id, d1User.email, 'DRIVER');
    d2Token = authService.generateToken(d2User.id, d2User.email, 'DRIVER');

    // Start HTTP and Socket.IO server on ephemeral port
    server = http.createServer(app);
    socketServer.init(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as any).port;
    serverUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    for (const s of sockets) {
      if (s.connected) s.disconnect();
    }
    await new Promise<void>((resolve) => socketServer.getIO()?.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));

    // Clean up created test records
    try {
      await prisma.ride.deleteMany({
        where: { riderId: riderUser.id },
      });
      await prisma.driver.deleteMany({
        where: { id: { in: [d1Driver.id, d2Driver.id] } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [riderUser.id, d1User.id, d2User.id] } },
      });
      await redis.del(`driver:location:${d1Driver.id}`, `driver:location:${d2Driver.id}`);
      await redis.srem('drivers:online', d1Driver.id, d2Driver.id);
    } catch {}
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Ensure clean ride state between tests
    if (riderUser?.id) {
      await prisma.ride.deleteMany({
        where: { riderId: riderUser.id },
      });
    }
  });

  function connectSocket(token: string) {
    const s = io(serverUrl, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    sockets.push(s);
    return s;
  }

  test('1. Real D1 GPS telemetry ingestion and Redis H3 spatial indexing', async () => {
    const locPacket = {
      driverId: d1Driver.id,
      latitude: 22.5646,
      longitude: 88.3510,
      heading: 45,
      speed: 25,
      accuracy: 10,
      timestamp: Date.now(),
    };

    const location = await locationService.updateDriverLocation(locPacket, DriverStatus.ONLINE);
    expect(location.driverId).toBe(d1Driver.id);
    expect(location.latitude).toBe(22.5646);
    expect(location.longitude).toBe(88.3510);
    expect(location.h3Index).toBeDefined();

    // Verify stored in Redis
    const stored = await locationService.getDriverLocation(d1Driver.id);
    expect(stored).not.toBeNull();
    expect(stored?.latitude).toBe(22.5646);
    expect(stored?.longitude).toBe(88.3510);

    // Verify H3 set index in Redis
    const inSet = await redis.smembers(`h3:${location.h3Index}:drivers`);
    expect(inSet).toContain(d1Driver.id);

    // Stale GPS rejection: an older timestamp must not overwrite
    const stalePacket = {
      ...locPacket,
      latitude: 10.0,
      longitude: 10.0,
      timestamp: Date.now() - 5000,
    };
    await locationService.updateDriverLocation(stalePacket, DriverStatus.ONLINE);
    const afterStale = await locationService.getDriverLocation(d1Driver.id);
    expect(afterStale?.latitude).toBe(22.5646); // Unchanged!
  });

  test('2. Deterministic Nearest-Driver Matching (H3 & Proximity sorting, D1 vs D2)', async () => {
    const pickupLat = 22.5650;
    const pickupLng = 88.3510;

    // Case A: D1 is at (22.5646, 88.3510) [approx 44 meters away]
    // D2 is at (22.5800, 88.3600) [approx 2 km away]
    await locationService.updateDriverLocation(
      { driverId: d1Driver.id, latitude: 22.5646, longitude: 88.3510, timestamp: Date.now() },
      DriverStatus.ONLINE
    );
    await locationService.updateDriverLocation(
      { driverId: d2Driver.id, latitude: 22.5800, longitude: 88.3600, timestamp: Date.now() },
      DriverStatus.ONLINE
    );

    let candidates = await matchingService.findTopCandidateDrivers(pickupLat, pickupLng, 8);
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates[0].driverId).toBe(d1Driver.id); // D1 is closest

    // Case B: Move D2 to (22.5651, 88.3510) [approx 11 meters away - CLOSER than D1]
    await locationService.updateDriverLocation(
      { driverId: d2Driver.id, latitude: 22.5651, longitude: 88.3510, timestamp: Date.now() },
      DriverStatus.ONLINE
    );

    candidates = await matchingService.findTopCandidateDrivers(pickupLat, pickupLng, 8);
    expect(candidates[0].driverId).toBe(d2Driver.id); // D2 is now closest! Proves no hardcoded bias for D1!

    // Reset D1 closer for subsequent lifecycle test
    await locationService.updateDriverLocation(
      { driverId: d1Driver.id, latitude: 22.5649, longitude: 88.3510, timestamp: Date.now() },
      DriverStatus.ONLINE
    );
  });

  test('3. Complete Real Ride Lifecycle: Request -> Assign -> Offer -> Accept -> Arrive -> Start -> Complete', async () => {
    const riderSocket = connectSocket(riderToken);
    const d1Socket = connectSocket(d1Token);

    await Promise.all([
      waitEvent(riderSocket, 'connect'),
      waitEvent(d1Socket, 'connect'),
    ]);

    // Setup listener on driver socket for incoming ride offer
    const offerPromise = waitEvent(d1Socket, 'ride:status_changed');

    // Step A: Rider requests ride
    const result = await rideService.createRide({
      riderId: riderUser.id,
      pickupLat: 22.5650,
      pickupLng: 88.3510,
      destLat: 22.5448,
      destLng: 88.3426,
      pickupAddress: 'Esplanade Metro Station, Kolkata',
      destAddress: 'Victoria Memorial, Kolkata',
    });

    expect(result.ride).toBeDefined();
    expect(result.ride.status).toBe(RideStatus.DRIVER_ASSIGNED);
    expect(result.ride.driverId).toBe(d1Driver.id);
    const rideId = result.ride.id;

    // Step B: Driver receives real-time offer event over WebSocket
    socketServer.emitRide(result.ride);
    const offerEvent = await offerPromise;
    expect(offerEvent.rideId).toBe(rideId);
    expect(offerEvent.status).toBe(RideStatus.DRIVER_ASSIGNED);

    // Join ride room for both participants
    riderSocket.emit('join', `ride:${rideId}`);
    d1Socket.emit('join', `ride:${rideId}`);

    // Step C: Driver accepts ride
    const arrivingPromise = waitEvent(riderSocket, 'ride:status_changed');
    const acceptedRide = await rideService.acceptRide(rideId, d1Driver.id);
    socketServer.emitRide(acceptedRide);

    const arrivingEvent = await arrivingPromise;
    expect(arrivingEvent.status).toBe(RideStatus.DRIVER_ARRIVING);

    // Step D: Driver arrives at pickup
    const arrivedPromise = waitEvent(riderSocket, 'ride:status_changed');
    const arrivedRide = await rideService.arriveRide(rideId, d1Driver.id);
    socketServer.emitRide(arrivedRide);

    const arrivedEvent = await arrivedPromise;
    expect(arrivedEvent.status).toBe(RideStatus.DRIVER_ARRIVED);

    // Step E: Driver starts ride
    const progressPromise = waitEvent(riderSocket, 'ride:status_changed');
    const progressRide = await rideService.startRide(rideId, d1Driver.id);
    socketServer.emitRide(progressRide);

    const progressEvent = await progressPromise;
    expect(progressEvent.status).toBe(RideStatus.IN_PROGRESS);

    // Step F: Driver completes ride
    const completedPromise = waitEvent(riderSocket, 'ride:status_changed');
    const completedRide = await rideService.completeRide(rideId, d1Driver.id);
    socketServer.emitRide(completedRide);

    const completedEvent = await completedPromise;
    expect(completedEvent.status).toBe(RideStatus.COMPLETED);
    expect(completedRide.finalFare).toBeGreaterThan(0);

    // Step G: Verify persisted state in PostgreSQL and Redis
    const dbRide = await prisma.ride.findUnique({ where: { id: rideId } });
    expect(dbRide?.status).toBe(RideStatus.COMPLETED);
    expect(dbRide?.finalFare).toBe(completedRide.finalFare);

    const d1StatusInDb = await prisma.driver.findUnique({ where: { id: d1Driver.id } });
    expect(d1StatusInDb?.status).toBe(DriverStatus.ONLINE); // Restored to ONLINE!

    const redisState = await redis.hgetall(`ride:${rideId}:state`);
    expect(redisState.status).toBe(RideStatus.COMPLETED);
  });

  test('4. Offer Decline and Re-dispatch to Next Eligible Driver', async () => {
    // Both drivers online and available
    await prisma.driver.update({ where: { id: d1Driver.id }, data: { status: DriverStatus.ONLINE } });
    await prisma.driver.update({ where: { id: d2Driver.id }, data: { status: DriverStatus.ONLINE } });
    await redis.sadd('drivers:online', d1Driver.id, d2Driver.id);

    // D1 is closest, D2 is second closest
    await locationService.updateDriverLocation(
      { driverId: d1Driver.id, latitude: 22.5649, longitude: 88.3510, timestamp: Date.now() },
      DriverStatus.ONLINE
    );
    await locationService.updateDriverLocation(
      { driverId: d2Driver.id, latitude: 22.5660, longitude: 88.3515, timestamp: Date.now() },
      DriverStatus.ONLINE
    );

    // Request ride: D1 gets assigned first
    const { ride } = await rideService.createRide({
      riderId: riderUser.id,
      pickupLat: 22.5650,
      pickupLng: 88.3510,
      destLat: 22.5448,
      destLng: 88.3426,
      pickupAddress: 'Esplanade Metro, Kolkata',
      destAddress: 'Park Street, Kolkata',
    });

    expect(ride.driverId).toBe(d1Driver.id);
    expect(ride.status).toBe(RideStatus.DRIVER_ASSIGNED);

    // D1 declines the offer
    const redispatched = await rideService.declineRide(ride.id, d1Driver.id);

    // D1 should be recorded in decline set and freed to ONLINE
    const declinedMembers = await redis.smembers(`ride:${ride.id}:declined`);
    expect(declinedMembers).toContain(d1Driver.id);

    // Re-dispatch should assign D2!
    expect(redispatched.driverId).toBe(d2Driver.id);
    expect(redispatched.status).toBe(RideStatus.DRIVER_ASSIGNED);

    // Clean up ride
    await rideService.cancelRide(ride.id);
  });

  test('5. Ride Cancellation by Rider restores Driver to ONLINE', async () => {
    await prisma.driver.update({ where: { id: d1Driver.id }, data: { status: DriverStatus.ONLINE } });
    await redis.sadd('drivers:online', d1Driver.id);

    await locationService.updateDriverLocation(
      { driverId: d1Driver.id, latitude: 22.5649, longitude: 88.3510, timestamp: Date.now() },
      DriverStatus.ONLINE
    );

    const { ride } = await rideService.createRide({
      riderId: riderUser.id,
      pickupLat: 22.5650,
      pickupLng: 88.3510,
      destLat: 22.5448,
      destLng: 88.3426,
      pickupAddress: 'Esplanade',
      destAddress: 'Howrah Bridge',
    });

    expect(ride.status).toBe(RideStatus.DRIVER_ASSIGNED);

    const cancelled = await rideService.cancelRide(ride.id, 'Rider cancelled');
    expect(cancelled.status).toBe(RideStatus.CANCELLED);

    const driverAfterCancel = await prisma.driver.findUnique({ where: { id: d1Driver.id } });
    expect(driverAfterCancel?.status).toBe(DriverStatus.ONLINE);
  });

  test('6. Concurrent Booking Protection (Serializing driver reservation)', async () => {
    // Only D1 online
    await prisma.driver.update({ where: { id: d1Driver.id }, data: { status: DriverStatus.ONLINE } });
    await prisma.driver.update({ where: { id: d2Driver.id }, data: { status: DriverStatus.OFFLINE } });
    await redis.sadd('drivers:online', d1Driver.id);
    await redis.srem('drivers:online', d2Driver.id);

    await locationService.updateDriverLocation(
      { driverId: d1Driver.id, latitude: 22.5649, longitude: 88.3510, timestamp: Date.now() },
      DriverStatus.ONLINE
    );

    // Create another rider
    const secondRider = await prisma.user.create({
      data: {
        id: randomUUID(),
        name: 'Second Concurrent Rider',
        email: `rider2_concurrent_${Date.now()}@test.local`,
        phone: `+91990${String(Date.now()).slice(-7)}`,
        passwordHash: 'not-a-login-hash',
        role: 'RIDER',
      },
    });

    // Two riders simultaneously request ride competing for the only driver (D1)
    const [result1, result2] = await Promise.allSettled([
      rideService.createRide({
        riderId: riderUser.id,
        pickupLat: 22.5650,
        pickupLng: 88.3510,
        destLat: 22.5448,
        destLng: 88.3426,
        pickupAddress: 'Esplanade',
        destAddress: 'Victoria',
      }),
      rideService.createRide({
        riderId: secondRider.id,
        pickupLat: 22.5650,
        pickupLng: 88.3510,
        destLat: 22.5448,
        destLng: 88.3426,
        pickupAddress: 'Esplanade',
        destAddress: 'Victoria',
      }),
    ]);

    // Exactly one should succeed and one should fail with 409 NO_DRIVER_AVAILABLE
    const fulfilled = [result1, result2].filter((r) => r.status === 'fulfilled');
    const rejected = [result1, result2].filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const winningRide = (fulfilled[0] as PromiseFulfilledResult<any>).value.ride;
    const losingError = (rejected[0] as PromiseRejectedResult).reason;

    expect(winningRide.driverId).toBe(d1Driver.id);
    expect(losingError.statusCode).toBe(409);
    expect(losingError.code).toBe('NO_DRIVER_AVAILABLE');

    // Clean up
    await prisma.ride.deleteMany({ where: { id: winningRide.id } });
    await prisma.user.delete({ where: { id: secondRider.id } });
  });

  test('7. Active ride restoration upon refresh/reconnect', async () => {
    await prisma.driver.update({ where: { id: d1Driver.id }, data: { status: DriverStatus.ONLINE } });
    await redis.sadd('drivers:online', d1Driver.id);
    await locationService.updateDriverLocation(
      { driverId: d1Driver.id, latitude: 22.5649, longitude: 88.3510, timestamp: Date.now() },
      DriverStatus.ONLINE
    );

    const { ride } = await rideService.createRide({
      riderId: riderUser.id,
      pickupLat: 22.5650,
      pickupLng: 88.3510,
      destLat: 22.5448,
      destLng: 88.3426,
      pickupAddress: 'Esplanade',
      destAddress: 'Victoria Memorial',
    });

    // Check active ride endpoint for rider
    const activeForRider = await rideService.getActiveRide(riderUser.id);
    expect(activeForRider).not.toBeNull();
    expect(activeForRider?.id).toBe(ride.id);

    // Check active ride endpoint for driver
    const activeForDriver = await rideService.getActiveRide(d1User.id);
    expect(activeForDriver).not.toBeNull();
    expect(activeForDriver?.id).toBe(ride.id);

    // Clean up
    await rideService.cancelRide(ride.id);
  });

  test('8. 45-Second Offer Expiry Timeout and Automatic Re-dispatch', async () => {
    // Both drivers online
    await prisma.driver.update({ where: { id: d1Driver.id }, data: { status: DriverStatus.ONLINE } });
    await prisma.driver.update({ where: { id: d2Driver.id }, data: { status: DriverStatus.ONLINE } });
    await redis.sadd('drivers:online', d1Driver.id, d2Driver.id);

    await locationService.updateDriverLocation(
      { driverId: d1Driver.id, latitude: 22.5649, longitude: 88.3510, timestamp: Date.now() },
      DriverStatus.ONLINE
    );
    await locationService.updateDriverLocation(
      { driverId: d2Driver.id, latitude: 22.5660, longitude: 88.3515, timestamp: Date.now() },
      DriverStatus.ONLINE
    );

    const { ride } = await rideService.createRide({
      riderId: riderUser.id,
      pickupLat: 22.5650,
      pickupLng: 88.3510,
      destLat: 22.5448,
      destLng: 88.3426,
      pickupAddress: 'Esplanade',
      destAddress: 'Howrah',
    });

    expect(ride.driverId).toBe(d1Driver.id);
    expect(ride.status).toBe(RideStatus.DRIVER_ASSIGNED);

    // Manually age the ride's updatedAt to 50 seconds ago in PostgreSQL
    const past = new Date(Date.now() - 50000);
    await prisma.ride.update({
      where: { id: ride.id },
      data: { updatedAt: past },
    });

    // Trigger offer expiry sweep
    await offerExpiryService.sweep(Date.now());

    // Verify ride re-dispatched to D2
    const expiredRide = await prisma.ride.findUnique({ where: { id: ride.id } });
    expect(expiredRide?.driverId).toBe(d2Driver.id);
    expect(expiredRide?.status).toBe(RideStatus.DRIVER_ASSIGNED);

    // Clean up
    await rideService.cancelRide(ride.id);
  });
});
