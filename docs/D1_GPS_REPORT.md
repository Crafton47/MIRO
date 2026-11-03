# D1 GPS investigation and verification ? 2026-11-03

## Confirmed failures

1. Actual frontend `.env` pointed both API and Socket.IO to `http://localhost:3000`. A phone resolves localhost to itself. This also introduced an HTTP endpoint into an HTTPS frontend instead of using the configured proxy.
2. Vite used basic-SSL's untrusted self-signed certificate by default. Startup output and NETWORK_SETUP.md advertised HTTP LAN URLs and outdated insecure-origin workarounds.
3. `main.js` called `socketClient.onError`, which was absent. Initialization stopped before GPS store-to-marker subscription and final setup. The restored listener has a regression test.
4. GPS errors and upload failures were mixed; the UI claimed live broadcast before server acknowledgment. Retry after transient GPS errors could silently reuse the existing watch. D1 socket markers bypassed timestamp rejection even when the telemetry store rejected an old packet.

These are confirmed code/configuration defects. The phone's original permission state and certificate trust state cannot be reconstructed remotely, so no claim is made that a particular original phone error was observed.

## Changes and preserved behavior

- Same-origin authenticated HTTP writes and Socket.IO subscription through trusted Vite HTTPS. No duplicate location writes, anonymous authentication shortcuts, or security bypass flags.
- Fail-closed TLS startup, explicit certificate provisioning, strict port 5173, private keys outside Vite's allowed filesystem, ignored certificate artifacts. HTTP development mode binds only to loopback.
- Installed mkcert and generated a CA-signed certificate for localhost, loopbacks and 192.168.1.8. Installed CA in Windows current-user trust; phone public CA export is `.certs/phone-rootCA.crt`. Restarted the project's existing Vite process with the trusted certificate.
- Distinct insecure-context, permission, unavailable/timeout, Socket.IO authentication and HTTP upload diagnostics. GPS telemetry shows last server acknowledgment independently of local readings.
- Watch generations prevent old callbacks and late upload responses affecting a restarted/stopped watch. Retry replaces an errored watch. Page restoration reconnects socket listeners; GPS requires explicit re-enable after pagehide.
- D1 marker uses measured coordinates directly without interpolation or road snapping. Delayed/invalid socket fixes are rejected. Popup identifies the last received fix rather than promising a continuously live sensor.
- D1 login and `/auth/me` map user ID to driver profile ID correctly. Backend ownership verifies the account owns D1; these restrictions remain unchanged.
- Existing PostgreSQL, Redis/H3 location processing, timestamp ordering, D2-D8 simulation, matching, routing, lifecycle and location broadcast audience are preserved. Existing nearby API coarse location privacy is preserved; D1's live marker does not use those rounded coordinates.

## Verification

- Backend suite: 77 existing tests passed (13 suites); the added D1 authenticated socket delivery/ownership test passed, for 78 passing backend tests across these runs. Integration suites skip by default.
- Frontend: all 23 reliability tests passed, including insecure context, denied permission, accuracy/staleness, timeout retry, old callback suppression, upload 401 and late-response handling, and missing socket-listener regression.
- Headless Edge browser suite passed rider login/request/cancellation and driver login/GPS/decline/reload/accept/arrive/start/complete. Added exact marker-coordinate assertion. This suite uses isolated API and GPS fixtures, never real driver records, and is not evidence of physical GPS accuracy.
- Backend TypeScript and frontend production builds passed.
- Real Redis integration test passed against local disposable DB 15, using unique keys and cleanup, with packet ordering and H3 migration verified. Live application Redis PING returned PONG; live PostgreSQL SELECT 1 passed. PostgreSQL mutation integration tests were not run against the application database.
- Verified real D1 and rider seed-account login and `/auth/me` over certificate-validated LAN HTTPS. Both accounts authenticated through the HTTPS Socket.IO proxy with websocket-only and polling-only transports. Tokens were not printed. No synthetic coordinates were sent to the live backend.
- Fresh headless Edge profile opened https://192.168.1.8:5173 with no certificate overrides: origin correct, `isSecureContext=true`, Geolocation API present, login modal loaded. Node HTTPS also validated the CA and host. Windows curl's revocation check reported unknown revocation status for the local development CA; no insecure curl override was used.
- `/api/v1/system/status` returns 404 with the existing demo mode disabled. This is intentional demo endpoint gating, not a GPS or authentication failure; live databases were checked directly instead. Mobile Connect still reports secure context, API origin and socket state, and its health ping uses `/health`.

## Remaining real-device acceptance

Install the public CA on the phone and verify no browser certificate warning. Confirm site and OS location permission, real fix accuracy, server acknowledgment, and the laptop marker while moving safely. Exercise network loss/recovery, denied/revoked permission, offline/online, background/foreground and the D1 ride lifecycle. Mobile OS background suspension remains a browser limitation. No real-phone test was available in this session.

See [NETWORK_SETUP.md](../NETWORK_SETUP.md) for exact URLs, installation instructions and troubleshooting.
