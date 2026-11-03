# MIRO evidence-based audit

Audit started 2026-11-03. Existing uncommitted changes were preserved. Status describes code review and automated verification, not physical-device certification.

## Architecture at the start of the audit

Vite 8 / vanilla JavaScript views and observable store; Leaflet maps; Photon autocomplete and reverse geocoding, Nominatim reverse fallback, OSRM routing. Express 4 / TypeScript backend with Zod validation, JWT and bcrypt authentication services. Prisma 5 targets PostgreSQL (User, Driver, Vehicle, Ride). Redis stores location hashes, H3 availability sets and ride state; a memory adapter exists. Socket.IO carries location and ride events. No versioned Prisma migrations are present; current setup uses db push. Two competing fleet simulators exist (browser road simulation and backend heading simulation). Jest tests cover fare, matching, state rules, API and GPS packets; frontend has a Node geospatial script. No lint script is configured.

| Issue ID | Category | Severity | File/Location | Evidence | Recommended Fix | Status |
|---|---|---|---|---|---|---|
| SEC-01 | Authorization | Critical | backend/src/routes/{ride,driver}.routes.ts | Mutating routes have no authenticate middleware; IDs come from request | Authenticate and enforce ownership | Fixed; HTTP security tests |
| SEC-02 | WebSocket | Critical | backend/src/websocket/socket.server.ts | No handshake authentication; arbitrary join and driver/ride action IDs | Authenticate, authorize rooms/actions and scope broadcasts | Fixed; real Socket.IO fixture tests |
| SEC-03 | Privilege escalation | Critical | backend/src/validators/auth.validator.ts | Public registration accepts ADMIN | Restrict public roles | Fixed; role validation test |
| SEC-04 | Privacy | High | services/ride/ride.service.ts and driver/driver.service.ts | user:true includes passwordHash; global ride broadcasts include personal information | Explicit selects and participant events | Fixed; explicit selects and participant events |
| SEC-05 | Deployment | High | config/env.ts, app.ts | Default signing key, wildcard CORS, public simulator and diagnostics | Production validation and explicit demo isolation | Fixed defaults; production deployment unverified |
| REL-01 | Concurrency | High | services/ride/ride.service.ts | Driver reserved before ride insert; accept and transitions read then update without status predicates | Transactional reservations and conditional writes | Fixed application guards; live DB concurrency unverified |
| GPS-01 | Real GPS | High | views/driverView.js, main.js, state/store.js | D1 defaults to Kolkata and simulated route fallback starts when GPS inactive | Never invent D1 coordinates or movement | Fixed; browser/GPS fixtures only |
| REL-02 | False success | High | views/{rider,driver}View.js | Network failures create local ride IDs and successful lifecycle transitions | Only apply server-confirmed state; show actionable errors | Fixed; browser fixture workflows |
| REL-03 | Dispatch | High | ride.service.ts / driverView.js | create assigns DRIVER_ASSIGNED; accept rejects DRIVER_ASSIGNED | Explicit acceptance transition for reserved driver | Fixed; service and browser checks |
| REL-04 | Simulator | High | services/simulator/simulator.service.ts / frontend main.js | Two position authorities; backend forces ONLINE even during ride | One authority; respect database availability | Fixed demo implementation; live database trip unverified |
| SEC-06 | XSS | High | frontend views, map popups, toast.js | API/address/name strings interpolated into innerHTML | Escape untrusted text and attributes | Fixed reviewed sinks; broader penetration testing outstanding |
| GPS-02 | Connectivity | High | frontend/utils/constants.js | HTTPS page targets :3000 although backend serves HTTP; configured URLs overridden | Same-origin development proxy with trusted TLS support | Proxy/TLS support implemented; phone trust setup manual |
| REL-05 | Matching | Medium | matching.service.ts | Pickup distance is correct, but DB failures fall back to eligible; missing freshness accepted | Fail closed on eligibility and validate finite/fresh coordinates | Fixed; metadata eligibility is no longer bypassed in tests |
| REL-06 | State | Medium | driver.service.ts / ride.service.ts | Driver can become ONLINE while assigned; start skips arrival | Guard availability and enforce lifecycle | Fixed; state/availability regressions |
| UI-01 | Marker hardening | Low | map/mapManager.js / style.css | Existing body/wrapper CSS already declares 50% radius; user reported square artifacts, not reproduced before change | Isolate D1 circular enforcement and inspect rendered result | Hardened; headless screenshots inspected |
| PERF-01 | Socket | Medium | frontend/api/socket.js | connect creates new socket while existing socket reconnects | Reuse socket and refresh auth without listener duplication | Fixed; socket instance reused |
| GPS-03 | GPS validation | Medium | validators / location.service.ts | Client timestamps trusted without future bound; HTTP strips accuracy/timestamp | Shared packet validation; server freshness checks | Fixed; validation regressions |
| NAV-01 | Routing | Medium | frontend/services/routingService.js | Off-route compares vertices, not segments; fetch has no timeout | Segment projection, bounded routing requests | Fixed; segment and failure regressions |
| SEC-07 | Abuse | Medium | backend/app.ts | No request throttling or payload limits tailored to app | Bounded request and authentication limits | Process-local limits added; shared ingress limits remain |
| OPS-01 | Release | Medium | backend/prisma / package scripts | No migrations, live DB concurrency tests or physical-device results | Document and perform release checks before deployment | Open: live DB, migration and physical-device release checks |

Full physical GPS, laptop/phone synchronization and visual browser verification remain manual until performed. Automated tests do not establish production security.

## Additional findings

| Issue ID | Category | Severity | File/Location | Evidence | Recommended Fix | Status |
|---|---|---|---|---|---|---|
| DEP-01 | Dependencies | Critical | backend/package-lock.json | Initial npm audit reported Handlebars critical, body-parser/Zod high, plus development-tool advisories | Patch compatible dependencies and migrate Zod validation | Critical/high resolved; 21 development low/moderate entries remain |
| UI-02 | Product truthfulness | Medium | frontend/views/riderView.js and driverView.js | UI offered tier multipliers without backend tier contract and seeded session earnings/trips | Offer supported Go tier; show actual session figures | Fixed |
| UI-03 | Mobile hierarchy | Medium | frontend/style.css | Initial 390?844 screenshot placed offer actions below the fold under a 48% map and secondary cards | Reduce driver map height and prioritize trip actions | Fixed; final fixture screenshot reviewed |
| NAV-02 | Runtime exception | Medium | frontend/views/driverView.js | Off-route handler called toast.warning, but toast exposes only info/error/success | Use supported feedback method | Fixed |

## Verification and boundaries

Backend build and 67 tests passed (3 opt-in PostgreSQL cases and 1 Redis case skipped); frontend build, 20 deterministic tests, 31 live-service assertions and two headless browser fixture workflows passed. PostgreSQL is mocked in service/HTTP/socket tests. The original 20 backend tests passed before changes. See MIRO_TEST_REPORT.md for commands, earlier failures, limitations and phone setup.

Unused scaffold (`counter.js`, Vite/JavaScript logo assets), historical duplicate backend/root docs and dormant browser fleet/simulation modules remain on disk to preserve existing work. They are not newly activated. The old D1 simulation module is no longer imported by the application and its start entrypoints reject use. No claim of exhaustive dead-code elimination is made.

## Follow-up findings

| Issue ID | Category | Severity | File/Location | Evidence | Recommended Fix | Status |
|---|---|---|---|---|---|---|
| DISP-01 | Dispatch | High | driverView.js / ride.service.ts | Decline called cancellation | Atomic nearest eligible replacement | Implemented; fixture regressions |
| DISP-02 | Reliability | Medium | server.ts / pending ride state | Assigned offers lacked expiry | Scan persisted timestamps, conditionally re-dispatch | 45-second expiry implemented and tested with mocked DB |
| SEC-08 | Reassignment authorization | High | middleware / ride service | Middleware checks can become stale after reassignment | Bind driver identity into read/write predicates | Fixed with delayed-driver regression |
| SIM-01 | Demo completeness | Medium | simulator.service.ts | Heading-only motion stopped at assignment | Road geometry and authoritative lifecycle | Implemented for D2-D8; fixture tests and live provider read |
| GEO-01 | Precision | Low | utils/geo.ts | Distances rounded to 10m before interpolation/ranking | Keep precision internally | Fixed; sub-10m segment test |


GPS ordering follow-up: location timestamps, hashes and H3 membership now update in a single standalone-Redis Lua operation, with a synchronous equivalent in the memory adapter. Active-ride restoration survives cache outages. Demo memory fallback is explicit and health output distinguishes it from Redis. Six new fixture regressions pass; real Redis script execution remains unverified.


Client tracking follow-up: socket and reconnect timestamps are preserved and checked before updating the shared location state or socket-driven map markers. Late updates from a replaced driver and older server echoes are rejected. Three additional deterministic regressions and repeated browser fixture journeys pass; physical GPS verification remains outstanding.


## Ride recovery and completion follow-up

The client now checks a state revision before applying a reconnect snapshot, rejects older lifecycle snapshots and backward status transitions, and remembers terminal rides during the session so delayed events cannot reopen them after dismissal. Rider cancellation records the returned terminal state before clearing the view. Driver completion events update session earnings once per ride, including when completion arrives over the socket; an explicit zero final fare is preserved.

Verification: frontend build, 14 deterministic reliability tests and both headless Edge fixture workflows passed. The three new regressions cover lifecycle rollback/terminal replay, reconnect races and duplicate completion accounting. These guards are session-local; persisted history, live integration and physical-device verification remain outstanding. Backend source was unchanged in this follow-up (previous result: 67 passed, four integration tests skipped).


Released-offer finding resolved: clearing an offer alone allowed delayed offer or accept responses to reopen it. Session-local release records now prevent replay, including release-before-offer delivery. Late releases preserve a newer assignment. Verified with three new regressions and repeated browser fixture workflows; persisted dispatch remains server-authoritative.


Fare/search follow-up: removed the fabricated local fare fallback and default booking price. A failed server estimate clears the quote; retry obtains a quote for review before another click books it. Booking checks for changed locations. Nearby search discards responses superseded by another search or pickup change. Frontend build, 20 reliability tests and both browser fixture workflows pass; live-service and phone verification remain outstanding.
