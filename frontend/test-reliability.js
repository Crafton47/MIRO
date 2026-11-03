import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { routingService } from './src/services/routingService.js';
import { escapeHtml } from './src/utils/escape.js';

function gpsHarness() {
  const writes = [], cleared = [], positions = [];
  let success, failure;
  const state = { currentMode: 'driver', currentUser: { id: 'd1' }, driverAvailability: 'ONLINE' };
  const sandbox = {
    window: { isSecureContext: true }, navigator: { geolocation: {
      watchPosition: (ok, error) => { success = ok; failure = error; return 7; }, clearWatch: id => cleared.push(id),
    } }, console: { warn() {}, debug() {} }, Date,
    store: { getState: () => state, setDriverLocation: position => positions.push(position) },
    DEMO_USERS: { driver1: { id: 'd1' } }, socketClient: {},
    apiClient: { updateDriverLocation: async (...args) => writes.push(args) },
  };
  const source = fs.readFileSync(new URL('./src/services/gpsService.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replaceAll('export const ', 'const ');
  vm.runInNewContext(`${source}\nglobalThis.service = gpsService;`, sandbox);
  return { sandbox, service: sandbox.service, state, writes, cleared, positions, position: p => success(p), error: e => failure(e), getFailure: () => failure };
}

test('GPS refuses insecure context without starting watcher', () => {
  const h = gpsHarness(); h.sandbox.window.isSecureContext = false; h.service.start();
  assert.equal(h.service.status, 'INSECURE'); assert.equal(h.service.watchId, null); assert.equal(h.writes.length, 0);
});
test('GPS permission denial clears watcher and never substitutes coordinates', () => {
  const h = gpsHarness(); h.service.start(); h.error({ code: 1, PERMISSION_DENIED: 1 });
  assert.equal(h.service.status, 'ERROR'); assert.deepEqual(h.cleared, [7]); assert.equal(h.positions.length, 0);
});
test('GPS accepts device readings once and ignores callbacks after stop', async () => {
  const h = gpsHarness(); h.service.start();
  const reading = { coords: { latitude: 22.56, longitude: 88.35, accuracy: 12, speed: 1, heading: 90 }, timestamp: Date.now() };
  h.position(reading); await Promise.resolve();
  assert.equal(h.writes.length, 1); assert.equal(h.positions[0].lat, 22.56);
  assert.equal(h.writes[0][1].accuracy, 12);
  h.service.stop(); h.position(reading);
  assert.equal(h.writes.length, 1); assert.deepEqual(h.cleared, [7]);
});
test('inaccurate and stale GPS never moves marker or writes backend', () => {
  const h = gpsHarness(); h.service.start();
  h.position({ coords: { latitude: 22, longitude: 88, accuracy: 900 }, timestamp: Date.now() });
  h.position({ coords: { latitude: 22, longitude: 88, accuracy: 10 }, timestamp: Date.now() - 60000 });
  assert.equal(h.positions.length, 0); assert.equal(h.writes.length, 0);
});
test('sparse road segment midpoint is on-route and progress decreases', () => {
  const line = [{ lat: 22, lng: 88 }, { lat: 22.02, lng: 88 }];
  const midpoint = { lat: 22.01, lng: 88 };
  assert.equal(routingService.findClosestPointOnRoute(midpoint, line).isOffRoute, false);
  const start = routingService.calculateRemainingProgress(line[0], line).remainingKm;
  assert.ok(Math.abs(routingService.calculateRemainingProgress(midpoint, line).remainingKm - start / 2) < .02);
});
test('routing service failure rejects without invented road geometry', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  try { await assert.rejects(routingService.getDrivingRoute({ lat: 21, lng: 88 }, { lat: 21.1, lng: 88 }), /503/); }
  finally { globalThis.fetch = original; }
});
test('invalid longitude cannot reach routing provider', async () => {
  await assert.rejects(routingService.getDrivingRoute({ lat: 22, lng: Infinity }, { lat: 23, lng: 88 }), /Invalid/);
});
test('untrusted HTML and quoted attributes are escaped', () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
});


test('location state rejects delayed snapshots, duplicates and wrong-driver events', async () => {
  const { AppStore } = await import('./src/state/store.js');
  const state = new AppStore();
  state.setActiveRide({ id: 'ride', driverId: 'd1' });
  const now = Date.now();
  const packet = { driverId: 'd1', lat: 22, lng: 88, updatedAt: now };
  assert.equal(state.setDriverLocation(packet), true);
  assert.equal(state.setDriverLocation({ ...packet, lat: 21, updatedAt: now - 1 }), false);
  assert.equal(state.setDriverLocation({ ...packet, lat: 21 }), false);
  assert.equal(state.setDriverLocation({ ...packet, driverId: 'd2', updatedAt: now + 1 }), false);
  assert.equal(state.getState().driverLocation.lat, 22);
  state.setActiveRide({ id: 'ride', driverId: 'd2' });
  assert.equal(state.getState().driverLocation.lat, null);
  assert.equal(state.setDriverLocation({ ...packet, updatedAt: now + 2 }), false);
  assert.equal(state.setDriverLocation({ ...packet, driverId: 'd2', updatedAt: now - 2 }), true);
});

test('local GPS cannot be rewound by a server echo and invalid positions are rejected', async () => {
  const { AppStore } = await import('./src/state/store.js');
  const state = new AppStore();
  state.setState({ currentMode: 'driver', currentUser: { id: 'd1' } });
  const packet = { driverId: 'd1', lat: 22, lng: 88, updatedAt: Date.now() };
  assert.equal(state.setDriverLocation(packet), true);
  for (const update of [{ updatedAt: packet.updatedAt - 1 }, { updatedAt: undefined }, { lat: Infinity }, { lng: 181 }, { updatedAt: Date.now() + 60000 }]) {
    assert.equal(state.setDriverLocation({ ...packet, ...update }), false);
  }
  assert.equal(state.getState().driverLocation.updatedAt, packet.updatedAt);
});

test('GPS ignores out-of-order, missing and future timestamps', () => {
  const h = gpsHarness(); h.service.start();
  const reading = { coords: { latitude: 22.56, longitude: 88.35, accuracy: 12, speed: 1, heading: 90 }, timestamp: Date.now() };
  h.position(reading);
  for (const timestamp of [reading.timestamp - 1, undefined, NaN, Date.now() + 60000]) h.position({ ...reading, timestamp });
  assert.equal(h.positions.length, 1);
  assert.equal(h.writes.length, 1);
});


test('ride state rejects lifecycle regression and cannot resurrect a dismissed completed ride', async () => {
  const { AppStore } = await import('./src/state/store.js');
  const state = new AppStore();
  const ride = { id: 'r1', driverId: 'd1', status: 'IN_PROGRESS', updatedAt: '2026-11-03T10:00:00Z' };
  assert.equal(state.setActiveRide(ride), true);
  assert.equal(state.setActiveRide({ ...ride, status: 'DRIVER_ARRIVING', updatedAt: '2026-11-03T10:00:01Z' }), false);
  assert.equal(state.setActiveRide({ ...ride, updatedAt: '2026-11-03T09:00:00Z' }), false);
  assert.equal(state.setActiveRide({ ...ride, status: 'COMPLETED' }), true);
  state.setActiveRide(null);
  assert.equal(state.setActiveRide(ride), false);
  assert.equal(state.getState().activeRide, null);
  assert.equal(state.setActiveRide({ id: 'r2', status: 'DRIVER_ASSIGNED' }), true);
});

test('a reconnect snapshot cannot overwrite a ride event received while fetching', async () => {
  const { AppStore } = await import('./src/state/store.js');
  const state = new AppStore();
  const revision = state.rideRevision;
  state.setActiveRide({ id: 'r1', status: 'DRIVER_ASSIGNED' });
  assert.equal(state.setActiveRide(null, revision), false);
  assert.equal(state.getState().activeRide.id, 'r1');
});

test('duplicate completion events count earnings once and preserve zero final fares', async () => {
  const { AppStore } = await import('./src/state/store.js');
  const state = new AppStore();
  const trip = { id: 'r1', status: 'COMPLETED', estimatedFare: 100, finalFare: 0 };
  state.addCompletedTrip(trip); state.addCompletedTrip(trip);
  state.addCompletedTrip({ id: 'r2', status: 'IN_PROGRESS', estimatedFare: 100 });
  assert.equal(state.getState().completedTrips.length, 1);
  assert.equal(state.getState().driverEarnings, 0);
});


test('decline or timeout release prevents delayed offers and accept responses from reopening a ride', async () => {
  const { AppStore } = await import('./src/state/store.js');
  const state = new AppStore();
  state.setState({ currentMode: 'driver', currentUser: { id: 'd1' }, driverAvailability: 'IN_RIDE' });
  const ride = { id: 'old', driverId: 'd1', status: 'DRIVER_ASSIGNED' };
  state.setActiveRide(ride);
  assert.equal(state.releaseDriverRide('old'), true);
  assert.equal(state.getState().activeRide, null);
  assert.equal(state.getState().driverAvailability, 'ONLINE');
  assert.equal(state.setActiveRide(ride), false);
  assert.equal(state.setActiveRide({ ...ride, status: 'DRIVER_ARRIVING' }), false);
});

test('late release preserves a newer offer and its busy availability', async () => {
  const { AppStore } = await import('./src/state/store.js');
  const state = new AppStore();
  state.setState({ currentMode: 'driver', currentUser: { id: 'd1' }, driverAvailability: 'IN_RIDE' });
  state.setActiveRide({ id: 'new', driverId: 'd1', status: 'DRIVER_ASSIGNED' });
  assert.equal(state.releaseDriverRide('old'), false);
  assert.equal(state.releaseDriverRide('old'), false);
  assert.equal(state.getState().activeRide.id, 'new');
  assert.equal(state.getState().driverAvailability, 'IN_RIDE');
  assert.equal(state.setActiveRide({ id: 'old', driverId: 'd1', status: 'DRIVER_ASSIGNED' }), false);
});

test('release arriving before an offer also invalidates an in-flight recovery snapshot', async () => {
  const { AppStore } = await import('./src/state/store.js');
  const state = new AppStore();
  state.setState({ currentMode: 'driver', currentUser: { id: 'd1' } });
  const revision = state.rideRevision;
  state.releaseDriverRide('old');
  assert.equal(state.setActiveRide({ id: 'old', driverId: 'd1', status: 'DRIVER_ASSIGNED' }), false);
  assert.equal(state.setActiveRide(null, revision), false);
  assert.equal(state.setActiveRide({ id: 'new', driverId: 'd1', status: 'DRIVER_ASSIGNED' }), true);
});


function riderHarness() {
  const state = { pickup: { lat: 22, lng: 88 }, destination: { lat: 23, lng: 89 }, fareEstimate: { estimatedFare: 100 } };
  const sandbox = {
    store: { getState: () => state, setState: update => Object.assign(state, update), setNearbyDrivers: drivers => { state.nearbyDrivers = drivers; } },
    apiClient: {}, routingService: { getDrivingRoute: async () => ({ coordinates: [], distanceKm: 3, durationMin: 10 }) },
    mapManager: { drawRoadRoute() {}, fitBounds() {}, clearRoute() {}, updateDriverMarkers() {} },
    toast: { error() {} }, console: { warn() {} }, document: { activeElement: null },
  };
  const source = fs.readFileSync(new URL('./src/views/riderView.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export class RiderView', 'class RiderView');
  vm.runInNewContext(`${source}\nglobalThis.view = Object.create(RiderView.prototype);`, sandbox);
  sandbox.view.render = () => {};
  sandbox.view.container = { contains: () => false };
  return { ...sandbox, state, view: sandbox.view };
}

test('backend fare failure clears the old quote without a fabricated fallback', async () => {
  const h = riderHarness();
  h.apiClient.estimateFare = async () => { throw new Error('Unavailable'); };
  await h.view.updateRouteAndFare();
  assert.equal(h.state.fareEstimate, null);
  assert.equal(h.view.currentRoadRoute, null);
  assert.equal(h.view.isEstimating, false);
});

test('nearby responses cannot overwrite a newer pickup search', async () => {
  const h = riderHarness(); const pending = [];
  h.apiClient.getNearbyDrivers = () => new Promise(resolve => pending.push(resolve));
  const first = h.view.fetchNearbyDrivers();
  h.state.pickup = { lat: 24, lng: 90 };
  const second = h.view.fetchNearbyDrivers();
  pending[1]({ success: true, data: [{ driverId: 'new', distanceKm: 1 }] }); await second;
  pending[0]({ success: true, data: [{ driverId: 'old', distanceKm: 1 }] }); await first;
  assert.equal(h.state.nearbyDrivers[0].driverId, 'new');
});

test('changing pickup invalidates nearby results even before another search begins', async () => {
  const h = riderHarness(); let resolve;
  h.apiClient.getNearbyDrivers = () => new Promise(done => { resolve = done; });
  const request = h.view.fetchNearbyDrivers();
  h.state.pickup = { lat: 24, lng: 90 };
  resolve({ success: true, data: [{ driverId: 'old', distanceKm: 1 }] }); await request;
  assert.equal(h.state.nearbyDrivers, undefined);
});

test('GPS retries after timeout and ignores callbacks from the old watch', () => {
  const h = gpsHarness(); h.service.start();
  const oldFailure = h.getFailure();
  h.error({ code: 3 });
  assert.match(h.service.lastError, /timed out/);
  h.service.start();
  assert.deepEqual(h.cleared, [7]);
  oldFailure({ code: 1 });
  assert.equal(h.service.status, 'REQUESTING');
});

test('GPS upload failure is visible separately from device fix and stop ignores late responses', async () => {
  const h = gpsHarness();
  h.sandbox.apiClient.updateDriverLocation = async () => { throw Object.assign(new Error('expired'), { status: 401 }); };
  h.service.start();
  h.position({ coords: { latitude: 22.56, longitude: 88.35, accuracy: 12 }, timestamp: Date.now() });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.service.status, 'ACTIVE');
  assert.match(h.service.sharingError, /401.*Sign in/);
  assert.equal(h.service.lastSharedTime, null);
  let reject;
  h.sandbox.apiClient.updateDriverLocation = () => new Promise((_, fail) => { reject = fail; });
  const pending = h.service._broadcastLocation(22.56, 88.35, 0, 0);
  h.service.stop(); reject(new Error('late')); await pending;
  assert.equal(h.service.status, 'STOPPED');
});

test('socket exposes the error listener required by application initialization', () => {
  const listeners = new Map();
  const socket = { on: (event, fn) => listeners.set(event, fn), off: event => listeners.delete(event) };
  const source = fs.readFileSync(new URL('./src/api/socket.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replaceAll('export const ', 'const ');
  const sandbox = { io: () => socket, apiClient: { token: 'test-token' }, WS_BASE_URL: 'https://localhost:5173' };
  vm.runInNewContext(`${source}\nglobalThis.client = socketClient;`, sandbox);
  let error;
  const unsubscribe = sandbox.client.onError(e => { error = e; });
  listeners.get('error')({ event: 'driver:location', message: 'Rejected' });
  assert.equal(error.event, 'driver:location');
  listeners.get('connect_error')({ message: 'Authentication required' });
  assert.match(sandbox.client.lastError, /authentication failed/);
  unsubscribe(); assert.equal(listeners.has('error'), false);
});
