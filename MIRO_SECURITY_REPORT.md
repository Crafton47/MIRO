# MIRO security report

2026-11-03. This is a defensive source review with targeted automated tests, not a penetration-test or production-security certification.

## Confirmed vulnerabilities and fixes

- **Unauthenticated HTTP mutations and IDOR:** ride and driver routes now require bearer authentication. Driver records must belong to the authenticated driver. Ride reads/cancellation require participation; driver lifecycle actions require the assigned driver. Creation checks rider identity. The fare estimate remains public and rate-limited.
- **Unauthenticated sockets, forged identities and arbitrary rooms:** handshake validates the JWT/account; events revalidate expiry and ownership. Arbitrary rooms are rejected. The server joins participant identity rooms, scopes ride/location broadcasts and closes expired sessions. Payload and event limits constrain abuse.
- **Public ADMIN registration:** public roles are limited to RIDER and DRIVER.
- **Password-hash disclosure:** driver and ride response relations explicitly select public profile fields. Discovery omits user IDs and H3 indexes, rounds locations to approximately 100-metre precision, and omits phone/email. Exact active-trip location is delivered to participants.
- **Ride races:** driver reservation and ride creation share a serializable transaction with bounded serialization retries. Lifecycle writes include expected current status. Failed competing writes return a conflict. Driver availability changes cannot override an active reservation. PostgreSQL behavior still needs dedicated live concurrency testing.
- **Stored/reflected HTML injection sinks:** addresses, names, vehicle strings, maneuver text, toast errors and connection-modal strings are escaped before HTML interpolation. This is a focused sink review, not a formal proof against every DOM-XSS vector.
- **Default production key and demo exposure:** production startup requires explicit JWT/database/Redis/CORS configuration; weak/default signing secrets fail startup. Demo simulator/diagnostics require explicit non-production DEMO_MODE. Demo account login and seeding are blocked in production. Production Redis errors no longer silently switch to memory.
- **GPS integrity and privacy:** D1 has no hardcoded starting position or active simulation fallback. GPS accuracy/staleness and timestamp bounds are checked. Browser readings stop on offline/page exit; reconnect retrieves authorized current state. The server can authenticate the reporting driver, but cannot attest that a browser's reported GPS is physically genuine.
- **Abuse and error handling:** 16KB JSON/socket payload limits, process-local API/login/socket rate limits, origin allowlist, hidden Express signature, safe production errors and conflict responses.

## Dependency audit

Initial backend audit: **25 affected dependency entries** (1 critical, 2 high, 18 moderate, 4 low). These are npm dependency-tree counts, not 25 independently exploitable application flaws.

Applied compatible patch updates and upgraded Zod to 4.6.7, adapting Zod error handling to `issues`. Verified installed patches include body-parser 1.20.9, Handlebars 4.7.10 and qs 6.16.2. Relevant advisories: [body-parser](https://github.com/advisories/GHSA-27r3-jxmh-p828), [Handlebars](https://github.com/advisories/GHSA-p8wg-vrv2-v86f), [Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).

Final checks:

| Audit | Result |
|---|---|
| Backend `npm.cmd audit --omit=dev --json` | 0 reported vulnerabilities |
| Frontend `npm.cmd audit --json` | 0 reported vulnerabilities |
| Backend full dependency tree | 21 entries: 4 low, 17 moderate, 0 high, 0 critical |

Remaining advisories propagate from development tooling, principally deepmerge and minimatch through Jest/coverage tooling. npm suggests disruptive Jest/ts-jest downgrades; these were not forced. Do not feed untrusted configuration or patterns to development tooling. Audit results are time-specific and are not proof of security.

## Release limitations

- No real database reset, migration, seed, user-data mutation or production deployment was performed. No live database concurrency claims are made.
- JWTs have a seven-day lifetime and no revocation/refresh mechanism. sessionStorage reduces persistence but is still accessible to same-origin JavaScript. Production needs a complete session/recovery design and a restrictive deployment CSP.
- Socket identity rooms are single-process; HTTP/socket throttles are process-local. Production needs shared ingress limits, appropriate proxy trust and a Socket.IO adapter.
- GPS ingestion now orders packets and updates H3 availability indexes in one standalone-Redis Lua operation. The real Redis integration test remains unexecuted; Redis Cluster is unsupported. Database status changes and Redis cache updates remain separate operations. Database-authoritative matching prevents availability cache state from overriding DB reservations, but cache synchronization can lag. Ride DB commits are returned even when cache synchronization fails, with a server warning.
- Discovery still exposes approximate nearby positions to authenticated users. Retention, access monitoring and privacy policy require product decisions.
- Active ride uniqueness currently relies on the application transaction path. Add database constraints after reviewing existing data; no migration was silently applied.
- Development demo diagnostics expose network/simulator information when deliberately enabled. Use only on a trusted local network.
- Routing/geocoding/map providers receive coordinates and have their own usage/privacy requirements. No service guarantees are established.

Do not deploy this MVP as production-secure solely because builds, tests and runtime dependency audits pass.

## Follow-up dispatch hardening

Driver declines and unanswered-offer expiry now re-dispatch using serializable reservations. Redis keeps per-ride declined-driver sets with a seven-day TTL; unavailable history fails closed. Losing Redis data loses exclusion history, so durable dispatch history remains a production improvement. The former driver receives only a release notification, not the replacement profile. Driver reads/writes include the driver identity checked during authorization, protecting against delayed old-driver actions after reassignment.

The demo simulator uses validated road geometry, an exact D2-D8 allowlist, 30-second failure backoff, nonoverlapping ticks and post-fetch cancellation checks. It cannot move D1. Pending offers older than 45 seconds are scanned every five seconds using persisted updatedAt; conditional writes resolve accept/cancel/timeout races. Live database concurrency remains unverified.


Redis connection logs no longer include connection URLs or raw connection errors. Memory fallback is limited to explicit development demo mode and health output identifies it. Active-ride reads tolerate location-cache failure without losing the authoritative database snapshot. Memory-adapter expiration regressions prevent expired decline history from being resurrected by subsequent set writes.


Client tracking now checks driver identity and timestamp ordering before accepting socket/reconnect locations. This complements server authorization and prevents delayed prior-assignment events or older echoes from overwriting current GPS state. These client guards are reliability protections, not a replacement for server-side access checks.


## Ride recovery and completion follow-up

The client now checks a state revision before applying a reconnect snapshot, rejects older lifecycle snapshots and backward status transitions, and remembers terminal rides during the session so delayed events cannot reopen them after dismissal. Rider cancellation records the returned terminal state before clearing the view. Driver completion events update session earnings once per ride, including when completion arrives over the socket; an explicit zero final fare is preserved.

Verification: frontend build, 14 deterministic reliability tests and both headless Edge fixture workflows passed. The three new regressions cover lifecycle rollback/terminal replay, reconnect races and duplicate completion accounting. These guards are session-local; persisted history, live integration and physical-device verification remain outstanding. Backend source was unchanged in this follow-up (previous result: 67 passed, four integration tests skipped).


Released-offer client guards now reject delayed snapshots after decline/timeout without modifying a newer assignment. Records last for the current page session; reload recovery continues to rely on the authenticated server snapshot and server-side dispatch exclusions. These guards do not replace server ownership checks.


Fare/search follow-up: removed the fabricated local fare fallback and default booking price. A failed server estimate clears the quote; retry obtains a quote for review before another click books it. Booking checks for changed locations. Nearby search discards responses superseded by another search or pickup change. Frontend build, 20 reliability tests and both browser fixture workflows pass; live-service and phone verification remain outstanding.
