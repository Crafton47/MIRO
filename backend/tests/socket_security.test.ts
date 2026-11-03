import http from 'http';
import { io, Socket } from 'socket.io-client';
import { SocketServer } from '../src/websocket/socket.server.js';
import { authService } from '../src/services/auth/auth.service.js';
import { prisma } from '../src/config/prisma.js';
import { rideService } from '../src/services/ride/ride.service.js';

const rideId = '33333333-3333-4000-a000-000000000001';
const driverId = '00000000-0000-4000-a000-000000000001';
const waitEvent = (socket: Socket, event: string) => new Promise<any>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 3000);
  socket.once(event, payload => { clearTimeout(timer); resolve(payload); });
});

describe('Real Socket.IO transport with mocked database', () => {
  let server: http.Server, sockets: Socket[], service: SocketServer, url: string;
  beforeEach(async () => {
    sockets = [];
    jest.spyOn(prisma.user, 'findUnique').mockImplementation(async ({ where }: any) => ({ id: where.id, role: 'RIDER', driver: null } as any));
    jest.spyOn(prisma.ride, 'findUnique').mockResolvedValue({ id: rideId, riderId: 'owner', driverId, driver: { userId: 'driver-user' } } as any);
    server = http.createServer(); service = new SocketServer(); service.init(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterEach(async () => {
    sockets.forEach(s => s.disconnect());
    await new Promise<void>(resolve => service.getIO().close(() => resolve()));
    jest.restoreAllMocks();
  });
  function client(id?: string, role = 'RIDER') {
    const socket = io(url, { autoConnect: false, reconnection: false, auth: id ? { token: authService.generateToken(id, 'test@example.test', role) } : {} });
    sockets.push(socket); return socket;
  }
  test('anonymous handshake rejected', async () => {
    const socket = client(); const error = waitEvent(socket, 'connect_error'); socket.connect();
    expect((await error).message).toBe('Authentication required');
  });
  test('forged room and ride action rejected before business logic', async () => {
    const socket = client('intruder'); const connected = waitEvent(socket, 'connect'); socket.connect(); await connected;
    const cancel = jest.spyOn(rideService, 'cancelRide');
    for (const [event, payload] of [['join', `ride:${rideId}`], ['ride:cancelled', { rideId }]] as const) {
      const error = waitEvent(socket, 'error'); socket.emit(event, payload);
      expect((await error).event).toBe(event);
    }
    expect(cancel).not.toHaveBeenCalled();
  });
  test('ride broadcasts reach only participants, including after reconnect', async () => {
    const owner = client('owner'), outsider = client('outsider');
    for (const socket of [owner, outsider]) { const ready = waitEvent(socket, 'connect'); socket.connect(); await ready; }
    const leaked = jest.fn(); outsider.on('ride:status_changed', leaked);
    let received = waitEvent(owner, 'ride:status_changed');
    service.emitRide({ id: rideId, riderId: 'owner', driverId, status: 'DRIVER_ASSIGNED' });
    expect((await received).rideId).toBe(rideId);
    owner.disconnect(); const ready = waitEvent(owner, 'connect'); owner.connect(); await ready;
    received = waitEvent(owner, 'ride:status_changed');
    service.emitRide({ id: rideId, riderId: 'owner', driverId, status: 'DRIVER_ARRIVING' });
    expect((await received).status).toBe('DRIVER_ARRIVING');
    expect(leaked).not.toHaveBeenCalled();
  });
  test('former driver receives release but no replacement ride profile', async () => {
    const replacement = '00000000-0000-4000-a000-000000000002';
    (prisma.user.findUnique as jest.Mock).mockImplementation(async ({ where }: any) => ({ id: where.id, role: 'DRIVER', driver: { id: where.id === 'old' ? driverId : replacement } }));
    const oldDriver = client('old', 'DRIVER'), nextDriver = client('next', 'DRIVER');
    for (const socket of [oldDriver, nextDriver]) { const ready = waitEvent(socket, 'connect'); socket.connect(); await ready; }
    const leaked = jest.fn(); oldDriver.on('ride:status_changed', leaked);
    const released = waitEvent(oldDriver, 'ride:unassigned');
    const assigned = waitEvent(nextDriver, 'ride:status_changed');
    service.emitUnassigned(driverId, rideId);
    service.emitRide({ id: rideId, riderId: 'owner', driverId: replacement, status: 'DRIVER_ASSIGNED' });
    expect(await released).toEqual({ rideId, reason: 'declined' });
    expect((await assigned).ride.driverId).toBe(replacement);
    expect(leaked).not.toHaveBeenCalled();
  });

  test('authenticated D1 fix is persisted and delivered exactly to its assigned rider', async () => {
    (prisma.user.findUnique as jest.Mock).mockImplementation(async ({ where }: any) => ({
      id: where.id, role: where.id === 'driver-user' ? 'DRIVER' : 'RIDER',
      driver: where.id === 'driver-user' ? { id: driverId } : null,
    }));
    jest.spyOn(prisma.driver, 'findUnique').mockResolvedValue({ id: driverId, userId: 'driver-user', status: 'ONLINE' } as any);
    jest.spyOn(prisma.ride, 'findFirst').mockResolvedValue({ id: rideId, riderId: 'owner', driverId } as any);
    const driver = client('driver-user', 'DRIVER'), rider = client('owner'), outsider = client('outsider');
    for (const socket of [driver, rider, outsider]) { const ready = waitEvent(socket, 'connect'); socket.connect(); await ready; }
    const leak = jest.fn(); outsider.on('location:update', leak);
    const received = waitEvent(rider, 'location:update');
    const packet = { driverId, latitude: 22.571234, longitude: 88.361234, accuracy: 7, timestamp: Date.now() };
    driver.emit('driver:location', packet);
    const result = await received;
    expect(result.latitude).toBe(packet.latitude);
    expect(result.longitude).toBe(packet.longitude);
    expect(result.updatedAt).toBe(packet.timestamp);
    expect(leak).not.toHaveBeenCalled();
    const rejected = waitEvent(outsider, 'error');
    outsider.emit('driver:location', packet);
    expect((await rejected).event).toBe('driver:location');
  });

});
