> For the current D1 HTTPS setup and verified phone URL, use [NETWORK_SETUP.md](NETWORK_SETUP.md). Latest GPS investigation: [docs/D1_GPS_REPORT.md](docs/D1_GPS_REPORT.md).

# MIRO test report and launch guide

Date: 2026-11-03 (Asia/Calcutta). Existing repository changes were preserved. No real database was reset, migrated or seeded.

## Executed verification

| Command / check | Result |
|---|---|
| Initial backend `npm.cmd test -- --runInBand` | 6 suites, 20 tests passed |
| Initial frontend build | Passed: JS 293.83KB / 82.85KB gzip |
| `npm.cmd run build` from repository root | Backend TypeScript and frontend production build passed |
| `npm.cmd test` from repository root | 12 backend suites / 67 tests passed; 4 opt-in integration tests skipped; 20 frontend reliability tests passed |
| `npm.cmd test --prefix frontend` | 31 assertions passed, including live OSRM/Photon/reverse-geocoding requests |
| `npm.cmd run test:browser --prefix frontend` | Headless Edge desktop rider and mobile driver fixture workflows passed; no uncaught browser exceptions; mobile horizontal-overflow assertion passed |
| Dependency audits | Frontend and backend production tree: zero reported advisories. Full backend tree: 21 low/moderate development entries remain |
| Lint | No existing lint configuration/script; not invented or claimed as passed |

Browser screenshots are in `docs/verification/`: sign-in desktop, rider desktop, driver offer mobile, driver navigation mobile. Browser tests use isolated API and GPS fixtures and a temporary Edge profile. They do not contact or mutate PostgreSQL. Map tiles may be incomplete in screenshots while external tile requests load. The socket indicator in fixture screenshots may show connecting because this harness does not mock Socket.IO; real Socket.IO behavior is covered separately by backend transport tests.

The security suite checks unauthenticated requests, forged rider IDs, cross-rider reads/cancellation, unauthorized driver location, invalid coordinates, public ADMIN rejection, reserved-driver acceptance, invalid start-before-arrival, conditional lifecycle writes, busy availability and future timestamps. Its Prisma calls are mocked. The concurrent-accept test checks conditional-write conflict handling; it is **not a live PostgreSQL race test**.

Frontend deterministic tests cover insecure context, permission denial, watcher cleanup, genuine-reading forwarding, stale/inaccurate rejection, sparse-segment navigation, route failure and HTML escaping.

## Failures encountered and resolved

- PowerShell blocked `npm.ps1`; commands use `npm.cmd` without changing execution policy.
- Sandboxed live-provider checks and npm audits initially failed on network access; reruns with approved access succeeded.
- The old public simulator status test failed after demo endpoints became opt-in; updated it to assert the secure default.
- Zod 4 removed `ZodError.errors`; migrated to `issues` and reran type checks/tests.
- The initial browser fixture login timed out because an existing frontend API override bypassed the fixture origin; the isolated harness now overrides its own environment and handles CORS. Application secrets/environment files were not edited.
- One later browser run waited on external font loading before application startup. The fixture harness now fulfills the font stylesheet locally and allows a bounded 30-second initialization window; its final run passed.
- A browser test command was once run from the wrong working directory; rerun from `frontend` succeeded.

Final frontend bundle: JS 288.03KB / 82.33KB gzip; CSS 57.25KB / 14.73KB gzip. No large framework or animation dependency was added.

## Local prerequisites and startup

Use an installed Node version compatible with the repository dependencies (verification used Node 24.19.0), npm, and the existing PostgreSQL/Redis services. Preserve your current `backend/.env`; verify DATABASE_URL and REDIS_URL privately. The schema is `backend/prisma/schema.prisma`. There are no checked-in versioned migrations. **Do not run db push or seed against existing/production data as part of this guide.** For a fresh disposable database, review schema/bootstrap changes first.

From `C:\Users\asus\Desktop\MIRO` in PowerShell:

```powershell
npm.cmd ci --prefix backend
npm.cmd ci --prefix frontend
npm.cmd run prisma:generate --prefix backend
npm.cmd run build
npm.cmd test
```

Run the backend in terminal 1:

```powershell
Set-Location C:\Users\asus\Desktop\MIRO\backend
$env:NODE_ENV = 'development'
$env:DEMO_MODE = 'true'  # optional: enables the local fleet controls/diagnostics
npm.cmd run dev
```

Run frontend in terminal 2:

```powershell
Set-Location C:\Users\asus\Desktop\MIRO\frontend
npm.cmd run dev
```

Open the URL printed by Vite (normally https://localhost:5173). Sign in as a rider on the laptop and as D1 on the phone. If the existing demo seed was previously provisioned, its development-only accounts are `rider@miro.local` and `driver1@miro.local`, with the seed's documented password `password123`. This guide does not create or overwrite those accounts. Existing custom passwords remain unchanged. A failed login must be resolved through your existing database/account setup; the UI no longer fabricates a session.

The default API/socket origin is the frontend origin. Vite proxies `/api`, `/health`, `/dashboard` and `/socket.io` to http://127.0.0.1:3000. Existing `VITE_API_URL` or `VITE_WS_URL` values take precedence: remove obsolete overrides from your local setup, or set both to the correct reachable API origin. Never point the phone at its own localhost. A custom split-origin backend needs CORS_ORIGINS set to the exact frontend origins.

## Trusted HTTPS on laptop and phone

The Vite configuration supports `MIRO_TLS_CERT` and `MIRO_TLS_KEY`; backend traffic stays behind its local proxy. Use a development certificate covering the laptop LAN IP. This follows the [mkcert instructions](https://github.com/FiloSottile/mkcert) and [Vite HTTPS/proxy configuration](https://vite.dev/config/server-options.html#server-https). Certificate installation is manual; this audit did not alter either device's trust store.

After installing mkcert from its official distribution, substitute the laptop's actual Wi-Fi IPv4 address:

```powershell
$miroLanIp = '192.168.1.25' # replace with your laptop address from ipconfig
$miroCertDir = Join-Path $env:LOCALAPPDATA 'MIRO-dev-cert'
New-Item -ItemType Directory -Force -Path $miroCertDir
mkcert -install
mkcert -cert-file "$miroCertDir\miro.pem" -key-file "$miroCertDir\miro-key.pem" localhost 127.0.0.1 $miroLanIp
$env:MIRO_TLS_CERT = "$miroCertDir\miro.pem"
$env:MIRO_TLS_KEY = "$miroCertDir\miro-key.pem"
Set-Location C:\Users\asus\Desktop\MIRO\frontend
npm.cmd run dev
```

Install/trust only mkcert's **rootCA.pem** on the test phone (locate it with `mkcert -CAROOT`); never copy `rootCA-key.pem`. On iOS, install the profile and enable full trust under Certificate Trust Settings. On Android, install the CA through device certificate/security settings; menu names vary. Open `https://<laptop-LAN-IP>:5173` with no certificate warning. The laptop and phone must share Wi-Fi/hotspot, with local firewall access restricted to the private network. No public tunnel or port forwarding is needed. Plain HTTP at a LAN IP is not a GPS solution. The older Chrome-flag instructions in historical docs are superseded by this guide.

## Physical-device acceptance checklist — not yet performed

1. Confirm the page is a secure context on the phone and the socket shows connected. Sign in as D1, go online, then enable Live GPS.
2. Deny permission once: expect an error and no invented marker. Grant permission and wait for accuracy within 100m.
3. Use the laptop rider's pickup near the phone. Confirm backend matching selects D1 only if D1 is the nearest eligible driver. D2–D8 are optional demo candidates.
4. Request a ride; D1 sees the assigned offer. Accept, mark arrived, start and complete. Verify both screens agree and fare/status come from the backend.
5. Test decline and rider cancellation. Decline should select the next eligible driver, or cancel if candidates are exhausted. Leave an offer unanswered for 45 seconds and verify the same behavior. Former drivers must not see or act on replacement assignments.
6. Walk with the phone; verify reported coordinates move D1, marker remains circular, and the map does not recenter on every update. Do not operate the phone while driving.
7. Disconnect/reconnect Wi-Fi, refresh each page, stop GPS and go offline. Matching should exclude stale readings after 60 seconds. Verify active-ride resynchronization.
8. In a dedicated test database, run competing ride requests/accepts, insert-failure rollback, simultaneous cancellation/completion, and Redis outage recovery. These database cases remain unverified here.

Backend tests also passed after removing `--forceExit`; Jest exited normally with handle detection enabled. `git diff --check` passed apart from informational LF/CRLF notices.

## Remaining verification

Actual Android/iOS GPS, trusted certificate setup, LAN synchronization, live PostgreSQL/Redis race behavior, load/soak testing, full screen-reader/keyboard audit and production deployment were not run. No claim that a phone physically navigated a route is made.

## Follow-up verification

New redispatch tests cover replacement reservation, exclusion history, candidate exhaustion, unauthorized decline, minimal release response and stale driver actions. Offer-expiry tests cover persisted timeout selection and accept-versus-expiry conflict. Simulator tests cover sub-10m geometry precision, D1 exclusion, authoritative lifecycle, routing failure and stop-during-fetch. Intentional failure tests log warnings. Browser fixture coverage now includes decline and authenticated session reload.

The backend route adapter made a successful live read-only OSRM request from Esplanade to Victoria Memorial, returning 63 geometry points. This was not a full live simulator journey.

PostgreSQL/Docker commands, standard installation directories and named services were not found by local checks. No disposable database URL was provided; no database was installed, reset or mutated.

### Opt-in live PostgreSQL suite (not executed)

`backend/tests/postgres.integration.test.ts` refuses non-local hosts and database names not beginning with `miro_test_`. It never falls back to the application's DATABASE_URL. Provision a separate local disposable database using your database tooling; then, in a separate terminal, substitute its connection URL:

```powershell
Set-Location C:\Users\asus\Desktop\MIRO\backend
$env:MIRO_TEST_DATABASE_URL = 'postgresql://TEST_USER:TEST_PASSWORD@127.0.0.1:5432/miro_test_dispatch?schema=public'
$env:DATABASE_URL = $env:MIRO_TEST_DATABASE_URL
npm.cmd run prisma:push
npm.cmd test -- --runInBand postgres.integration.test.ts
```

Do not point these commands at the application database. They were not executed here. The suite creates unique fixture rows and retains them for inspection; it does not delete/reset databases or existing rows. Its three tests exercise concurrent reservation, one-active-ride-per-rider and persisted lifecycle transitions. Redis remains the test-only memory adapter, so this is not a Redis integration test.

The final Socket.IO regression also verifies that a former driver receives a minimal release event and receives no replacement ride profile. Latest backend total: 67 passed, 4 opt-in integration cases skipped (three PostgreSQL, one Redis).


## GPS ordering and outage recovery follow-up

Six additional regressions cover packet ordering and H3 membership, busy-driver removal, the Redis script adapter, expiration semantics, and active-ride restoration when location storage fails. The backend build and Jest suite were rerun; frontend verification above is from the preceding pass, with no frontend changes in this follow-up.

GPS writes now use one Lua operation on standalone Redis. The live Lua integration case remains skipped unless MIRO_TEST_REDIS_URL explicitly selects a local, nonzero disposable Redis database (for example redis://127.0.0.1:6379/15). Run `npm.cmd test --prefix backend -- --runInBand redis.integration.test.ts` with that variable set in the test process. The suite removes only its uniquely named fixture keys and set membership; it never flushes a database. No real Redis execution is claimed here. Redis Cluster is not supported by this script.

Memory fallback requires explicit non-production DEMO_MODE=true and is reported as memory-demo by system status. Once fallback occurs, restart the application to reconnect to Redis. Other modes retain reconnecting Redis and do not silently switch stores. Active-ride restoration returns the database ride with location:null when the cache is unavailable.


## Client location ordering follow-up

Frontend build, all 11 deterministic reliability tests, and the headless Edge rider and driver fixture workflows passed after the client ordering changes. Three new tests cover delayed/duplicate positions, reassigned drivers, local GPS versus server echoes, invalid coordinates, and missing/future/out-of-order device timestamps. Browser fixtures include decline/reload and completion; they do not substitute for physical GPS or a live service journey. Backend results remain the previous 67 passed / 4 integration cases skipped; no backend code changed in this follow-up.


## Ride recovery and completion follow-up

The client now checks a state revision before applying a reconnect snapshot, rejects older lifecycle snapshots and backward status transitions, and remembers terminal rides during the session so delayed events cannot reopen them after dismissal. Rider cancellation records the returned terminal state before clearing the view. Driver completion events update session earnings once per ride, including when completion arrives over the socket; an explicit zero final fare is preserved.

Verification: frontend build, 14 deterministic reliability tests and both headless Edge fixture workflows passed. The three new regressions cover lifecycle rollback/terminal replay, reconnect races and duplicate completion accounting. These guards are session-local; persisted history, live integration and physical-device verification remain outstanding. Backend source was unchanged in this follow-up (previous result: 67 passed, four integration tests skipped).


## Released-offer recovery verification

Frontend build, 17 deterministic tests and both headless browser fixture workflows passed. Three new cases cover delayed offer/accept replay after release, duplicate releases while a newer offer is active, and release-before-offer ordering with an in-flight reconnect snapshot. No backend changes or live integration runs occurred in this follow-up.


Fare/search follow-up: removed the fabricated local fare fallback and default booking price. A failed server estimate clears the quote; retry obtains a quote for review before another click books it. Booking checks for changed locations. Nearby search discards responses superseded by another search or pickup change. Frontend build, 20 reliability tests and both browser fixture workflows pass; live-service and phone verification remain outstanding.
