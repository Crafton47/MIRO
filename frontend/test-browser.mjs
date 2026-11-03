// Real headless Edge + CDP, isolated API/GPS fixtures. No database is touched.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = path.resolve('../docs/verification');
await fs.mkdir(output, { recursive: true });
const profile = await fs.mkdtemp(path.join(process.env.TEMP || output, 'miro-browser-'));
process.env.VITE_API_URL = ''; process.env.VITE_WS_URL = '';
const vite = await createServer({ configFile: false, root: process.cwd(), server: { host: '127.0.0.1', port: 0 } });
await vite.listen();
const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
const browser = spawn(process.env.MIRO_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
  '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
let ws, id = 0;
const pending = new Map();
const errors = [];
let role = 'RIDER', active = null;
const riderId = '11111111-1111-4000-a000-000000000001';
const driverId = '00000000-0000-4000-a000-000000000001';
const ride = { id: '33333333-3333-4000-a000-000000000001', riderId, driverId, status: 'DRIVER_ASSIGNED', pickupLat: 22.5646, pickupLng: 88.351, destLat: 22.5448, destLng: 88.3426, pickupAddress: 'Esplanade Metro', destAddress: 'Victoria Memorial', estimatedFare: 100, distanceKm: 2.7, durationMin: 6, rider: { name: 'Test rider', phone: '0000000000' }, driver: { id: driverId, user: { name: 'Test D1' }, vehicle: { model: 'Test car', numberPlate: 'TEST-01' } } };
const user = () => ({ id: role === 'RIDER' ? riderId : '22222222-2222-4000-a000-000000000001', name: 'Test user', role, driverId: role === 'DRIVER' ? driverId : null });
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const key = ++id; pending.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params }));
});
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
async function until(expression) {
  for (let i = 0; i < 300; i++) { if (await evaluate(expression)) return; await sleep(100); }
  console.error('Browser state:', await evaluate('document.body.innerText'), errors);
  await screenshot('failure.png');
  throw new Error(`Timed out: ${expression}`);
}
async function screenshot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(path.join(output, name), Buffer.from(result.data, 'base64'));
}
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await sleep(100); }
  }
  if (!port) throw new Error('Edge did not start');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  ws.addEventListener('message', async event => {
    const packet = JSON.parse(event.data);
    if (packet.id) {
      const handler = pending.get(packet.id); pending.delete(packet.id);
      if (packet.error) handler?.reject(new Error(packet.error.message)); else handler?.resolve(packet.result);
      return;
    }
    if (packet.method === 'Runtime.exceptionThrown') errors.push(packet.params.exceptionDetails.exception?.description || packet.params.exceptionDetails.text);
    if (packet.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = packet.params;
    let data = { success: true, data: {} }, status = 200;
    if (request.url.includes('fonts.googleapis.com')) {
      await send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/css' }], body: '' });
      return;
    }
    const url = new URL(request.url), pathname = url.pathname;
    if (pathname === '/api/v1/auth/login') data.data = { token: 'fixture-token', user: user() };
    else if (pathname === '/api/v1/auth/me') data.data = user();
    else if (pathname === '/api/v1/rides/active') data.data = active;
    else if (pathname === '/api/v1/drivers/nearby') data.data = [{ driverId, driverName: 'Test D1', latitude: 22.5646, longitude: 88.351, distanceKm: .2, etaMinutes: 1 }];
    else if (pathname === `/api/v1/drivers/${driverId}`) data.data = { status: 'ONLINE', vehicle: ride.driver.vehicle };
    else if (pathname.endsWith('/location')) data.data = {};
    else if (pathname.endsWith('/status')) { data.data = { status: 'ONLINE' }; if (pathname.includes('/system/')) status = 404; }
    else if (pathname === '/api/v1/rides/estimate') data.data = { estimatedFare: 100, distanceKm: 2.7, durationMin: 6 };
    else if (pathname === '/api/v1/rides' && request.method === 'POST') { active = { ...ride }; data.data = { ride: active }; }
    else if (pathname.endsWith('/decline')) { active = null; data.data = { rideId: ride.id, released: true }; }
    else if (/\/(accept|arrive|start|complete|cancel)$/.test(pathname)) {
      const action = pathname.split('/').pop();
      active = { ...active, status: ({ accept: 'DRIVER_ARRIVING', arrive: 'DRIVER_ARRIVED', start: 'IN_PROGRESS', complete: 'COMPLETED', cancel: 'CANCELLED' })[action] };
      data.data = active;
    } else if (url.hostname === 'router.project-osrm.org') data = { code: 'Ok', routes: [{ distance: 2700, duration: 360, geometry: { coordinates: [[88.351,22.5646],[88.35,22.55],[88.3426,22.5448]] }, legs: [{ summary: 'Test route', steps: [] }] }] };
    else if (url.hostname.includes('photon') || url.hostname.includes('nominatim')) data = { features: [] };
    try { await send('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' }, { name: 'Access-Control-Allow-Methods', value: 'GET,POST,PATCH,OPTIONS' }], body: Buffer.from(JSON.stringify(data)).toString('base64') }); }
    catch (error) { errors.push(error.message); }
  });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Fetch.enable', { patterns: ['*fonts.googleapis.com/*', '*/api/v1/*', '*/health', '*router.project-osrm.org/*', '*photon.komoot.io/*', '*nominatim.openstreetmap.org/*'].map(urlPattern => ({ urlPattern })) });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: origin });
  await until("!!document.querySelector('.session-form')");
  await screenshot('sign-in-desktop.png');
  await evaluate("document.querySelector('[name=email]').value='rider@example.test';document.querySelector('[name=password]').value='fixture';document.querySelector('.session-form').requestSubmit();");
  await until("!!document.querySelector('#btn-request-ride')");
  await screenshot('rider-desktop.png');
  await evaluate("document.querySelector('#btn-request-ride').click()");
  await until("!!document.querySelector('#btn-cancel-ride')");
  await evaluate("document.querySelector('#btn-cancel-ride').click()");
  await until("!!document.querySelector('#btn-request-ride')");
  console.log('PASS browser rider sign-in, request and cancellation (fixture API)');
  role = 'DRIVER'; active = { ...ride };
  await evaluate('sessionStorage.clear()');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(navigator, 'geolocation', { value: { watchPosition(ok) { globalThis.gpsTimer=setInterval(()=>ok({coords:{latitude:22.5646,longitude:88.351,accuracy:10,heading:90,speed:0},timestamp:Date.now()}),2000); return 1; }, clearWatch() { clearInterval(globalThis.gpsTimer); } } });" });
  await send('Page.navigate', { url: origin });
  await until("!!document.querySelector('.session-form')");
  await evaluate("document.querySelector('[name=email]').value='driver@example.test';document.querySelector('[name=password]').value='fixture';document.querySelector('.session-form').requestSubmit();");
  await until("!!document.querySelector('#btn-accept-ride')");
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'mobile page must not overflow horizontally');
  await screenshot('driver-offer-mobile.png');
  await evaluate("document.querySelector('#btn-reject-ride').click()");
  await until("!document.querySelector('#btn-reject-ride')");
  assert.equal(active, null, 'decline releases the browser offer');
  active = { ...ride };
  await send('Page.navigate', { url: origin });
  await until("!!document.querySelector('#btn-accept-ride')");
  await evaluate("document.querySelector('#btn-gps-start').click()");
  await until("document.querySelector('#telemetry-lat')?.textContent.includes('22.56460')");
  assert.deepEqual(await evaluate("import('/src/map/mapManager.js').then(({mapManager}) => { const p = mapManager.driverMarkers.get('00000000-0000-4000-a000-000000000001')?.getLatLng(); return p ? [p.lat, p.lng] : null; })"), [22.5646, 88.351], 'D1 marker equals the device fixture exactly');
  await evaluate("document.querySelector('#btn-accept-ride').click()");
  await until("!!document.querySelector('#btn-force-arrive')");
  await screenshot('driver-navigation-mobile.png');
  await evaluate("document.querySelector('#btn-force-arrive').click()");
  await until("!!document.querySelector('#btn-start-ride')");
  await evaluate("document.querySelector('#btn-start-ride').click()");
  await until("!!document.querySelector('#btn-complete-ride')");
  await evaluate("document.querySelector('#btn-complete-ride').click()");
  await until("!document.querySelector('#btn-complete-ride')");
  assert.deepEqual(errors, [], 'No uncaught browser exceptions');
  console.log('PASS browser driver sign-in, mocked GPS, decline/reload, accept, arrive, start, complete and mobile overflow check');
  console.log(`Screenshots: ${output}`);
} finally {
  try { if (ws?.readyState === WebSocket.OPEN) await send('Browser.close'); } catch {}
  ws?.close(); browser.kill(); await vite.close();
  // Retain isolated temporary profile for failure diagnosis; never delete user profiles.
}
