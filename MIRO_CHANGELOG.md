# MIRO changelog — 2026-11-03

This pass builds on substantial pre-existing uncommitted work. No reset, cleanup of user changes, database migration or production deployment was performed.

| Files touched in this pass | Reason |
|---|---|
| `backend/src/services/access.ts`, `middleware/ownership.middleware.ts`, `routes/{auth,ride,driver,simulator}.routes.ts` | Shared ownership checks, authenticated routes, session/active-ride endpoints |
| `backend/src/websocket/socket.server.ts` | Authenticated sockets, participant rooms, scoped events, expiry and rate limits |
| `backend/src/controllers/{ride,driver,simulator}.controller.ts` | Scoped HTTP-triggered events, precise authenticated location writes, approximate discovery, validated simulator settings |
| `backend/src/services/ride/ride.service.ts` | Transactional reservation/create, conditional lifecycle writes, reserved-driver acceptance, active-ride snapshots, best-effort cache synchronization |
| `backend/src/services/driver/driver.service.ts` | Safe profile fields, busy-state protection, radius filter, committed-status/cache separation |
| `backend/src/services/{matching,location,simulator,auth}/*.ts` | Fail-closed driver eligibility, GPS freshness, single demo authority, production demo-login exclusion and JWT algorithm restriction |
| `backend/src/config/{env,redis,security}.ts`, `app.ts`, `middleware/{rateLimit,error}.middleware.ts` | Explicit production configuration, restricted CORS, demo isolation, payload/rate limits, safe errors and Zod 4 compatibility |
| `backend/src/validators/{auth,driver,websocket}.validator.ts` | Public role restriction and tighter status/GPS/query validation |
| `backend/prisma/seed.ts` | Reject demo seeding in production; seed was not executed |
| `backend/package.json`, `backend/package-lock.json` | Patched dependency tree, Zod 4 upgrade, and test exit without forced termination |
| `backend/tests/{api,h3_matching,matching_proximity,security,socket_security}.test.ts` | Secure-default expectations, metadata mocks without test-mode business bypass, authorization/lifecycle/socket regressions |
| `frontend/src/components/session.js`, `api/{client,socket}.js`, `state/store.js` | Real sign-in/session handling, correct socket reuse, no default D1 position, explicit request timeout |
| `frontend/src/main.js`, `views/{rider,driver}View.js` | Server-confirmed workflow, no offline fabricated rides, decline control, active-ride restoration, supported fare tier, GPS-only D1, stale-request guards |
| `frontend/src/services/{gpsService,routingService,geocodingService,simulationEngine}.js` | Accurate/stale GPS handling, D1 simulation disabled, segment projection, request bounds and bounded reverse cache |
| `frontend/src/map/mapManager.js`, `utils/{escape,toast}.js` | Circular D1 marker enforcement, interpolation between real reports, fewer icon rebuilds, escaped text and live feedback |
| `frontend/src/components/networkModal.js`, `utils/constants.js`, `vite.config.js` | Same-origin API/socket proxy, configurable trusted TLS, corrected phone instructions |
| `frontend/src/style.css`, `frontend/index.html` | Mobile layout hierarchy/touch targets, focus and reduced-motion styling, accessible sign-in, duplicate stylesheet removal |
| `frontend/test-reliability.js`, `frontend/test-browser.mjs`, `frontend/package.json` | Deterministic frontend regressions and headless Edge fixture workflow harness without extra dependencies |
| Root `package.json` | Build both applications and run backend/frontend deterministic tests |
| `MIRO_*.md`, README/network-guide notices, `docs/verification/*.png` | Evidence, limitations, reproducible checks, setup and visual review artifacts |

## Intentional contract and behavior changes

- Protected HTTP endpoints require `Authorization: Bearer <token>`; socket handshake requires `auth.token`. Socket room/action IDs no longer grant authorization.
- Registration no longer accepts ADMIN. Driver status requests accept ONLINE/OFFLINE; IN_RIDE is owned by ride logic.
- Acceptance is for the reserved driver and transitions DRIVER_ASSIGNED → DRIVER_ARRIVING. Starting requires DRIVER_ARRIVED. No candidates returns 409 instead of a stranded request.
- Demo simulator/diagnostics require non-production `DEMO_MODE=true`; simulator calls require authentication. Production blocks demo accounts/seeding.
- Nearby API omits `userId`/`h3Index` and rounds coordinates. Existing route URLs remain; `/auth/me` and `/rides/active` were added.
- Tokens use sessionStorage; old persistent demo sessions are not silently reused. Switching account roles requires signing out/in. Only the existing backend-supported MIRO Go tier is offered.
- API failures remain failures in the UI. D1 waits for genuine GPS; browser fleet simulation no longer competes with the backend simulator.
- Zod is upgraded from 3.x to 4.x; central validation error formatting preserves the application error envelope.

## Deliberately outstanding

See MIRO_FEATURE_CHECKLIST.md and MIRO_SECURITY_REPORT.md for production/session/migration work, physical-device/database verification and production release hardening. A successful automated run does not remove these limitations.

## Follow-up: re-dispatch, offer expiry and road demos

- Ride service, ownership middleware, controller/routes and socket server: authenticated POST `/api/v1/rides/:id/decline`, atomic replacement reservations, Redis exclusions, minimal release response and private `ride:unassigned` notifications. Driver identity is bound into read/write predicates.
- New `matching/offerExpiry.service.ts` and server startup hook: scans every five seconds for pending offers older than 45 seconds. Persisted timestamps survive process restarts; conflicting accepted/cancelled offers are preserved.
- Simulator service and new `simulator/roadRoute.ts`: validated OSRM road movement and automatic D2-D8 lifecycle replace heading-only motion. No D1 movement or straight-line fallback. Generation guards, overlap prevention and retry backoff bound failures.
- Geographic utility and matching service: precise internal distances, rounded presentation.
- Frontend API/view/store/main: decline, timeout/release feedback, old-driver position clearing on reassignment, late-response protection and browser fixture coverage.
- New redispatch, offer_expiry, demo_roads and opt-in postgres.integration test files.

DEMO_ROUTING_URL can override the default OSRM origin with a compatible trusted provider. Three live database cases remain skipped until a dedicated test database is provided. No physical-phone verification is claimed.


## GPS storage and Redis recovery follow-up

- Added locationStore.ts with atomic standalone-Redis Lua ordering and H3 index updates; location.service.ts decodes the saved snapshot rather than trusting an incoming stale packet.
- Added synchronous memory-adapter ordering and corrected expiration on reads and writes.
- Restricted memory fallback to explicit development demo mode, removed connection details from logs, and identified fallback in system status.
- Preserved active-ride restoration when location lookup fails.
- Added six regression tests and an opt-in real Redis integration case. Latest backend verification: 67 passed, 4 integration cases skipped. No application database or production configuration was changed.


## Client location ordering follow-up

- Preserved location timestamps and accuracy through reconnect snapshots and socket events.
- Guarded the shared location store against older/duplicate positions, invalid coordinates/timestamps and drivers outside the current session or assignment. Reassignment clears the previous driver's location and ordering state.
- Device GPS now retains its timestamp in state and ignores delayed readings, preventing a server echo from rewinding a newer local position.
- Frontend build, 11 reliability tests and both headless browser fixture journeys pass.


## Ride recovery and completion follow-up

The client now checks a state revision before applying a reconnect snapshot, rejects older lifecycle snapshots and backward status transitions, and remembers terminal rides during the session so delayed events cannot reopen them after dismissal. Rider cancellation records the returned terminal state before clearing the view. Driver completion events update session earnings once per ride, including when completion arrives over the socket; an explicit zero final fare is preserved.

Verification: frontend build, 14 deterministic reliability tests and both headless Edge fixture workflows passed. The three new regressions cover lifecycle rollback/terminal replay, reconnect races and duplicate completion accounting. These guards are session-local; persisted history, live integration and physical-device verification remain outstanding. Backend source was unchanged in this follow-up (previous result: 67 passed, four integration tests skipped).


## Released-offer recovery

Centralized decline and timeout handling in AppStore.releaseDriverRide. The session remembers released ride IDs, rejects subsequent offer/action snapshots for them, and invalidates older reconnect reads. A late release for a different ride cannot clear the current offer or reset busy availability. Added three regression cases; frontend build, 17 tests and browser fixtures pass.


Fare/search follow-up: removed the fabricated local fare fallback and default booking price. A failed server estimate clears the quote; retry obtains a quote for review before another click books it. Booking checks for changed locations. Nearby search discards responses superseded by another search or pickup change. Frontend build, 20 reliability tests and both browser fixture workflows pass; live-service and phone verification remain outstanding.
