# MIRO feature checklist

Reviewed 2026-11-03. “Verified” below specifies the verification method; it does not mean physical-device or live PostgreSQL certification.

| Area | Existing implementation | Improvements in this pass | Verification / remaining limitation |
|---|---|---|---|
| Architecture | Vite, vanilla JS, Leaflet; Express/TypeScript, Prisma/PostgreSQL, Redis/H3, Socket.IO | Preserved architecture and existing user changes | Both builds pass |
| Authentication | Backend login/register existed; UI relied on demo identities | Sign-in dialog, validated session restoration, role-bound dashboard, sign-out, sessionStorage tokens | Browser fixtures and HTTP security tests |
| Location selection | Map clicks, draggable endpoints, popular places, Photon autocomplete and reverse lookup | Escaped addresses, bounded fetches/cache, stale map-click protection | Live geospatial checks pass; extended keyboard/screen-reader review remains |
| Route preview | OSRM road geometry and maneuvers | Request timeout, coordinate validation, stale route-result guard, failure clears old route | Live route and deterministic failure tests |
| Fare | Backend Haversine estimate with INR base/distance/time rates | Only supported MIRO Go option is bookable; removed misleading road-pricing label | Fare tests pass. Fare remains an estimate, not a metered or road-distance final bill |
| Nearby drivers | H3 lookup and pickup-relative Haversine ranking | Confirm database availability, freshness/accuracy checks, radius filtering, approximate discovery coordinates | Matching tests with mocked metadata; no D1 preference |
| Booking | Backend nearest-driver reservation | Serializable transaction for reservation + ride insertion; no-driver response; removed invented offline bookings | Service contract tests and browser fixture booking/cancel |
| Dispatch | Driver dashboard and status cards | Only reserved driver accepts; acceptance moves ASSIGNED to ARRIVING; decline automatically re-dispatches; 45-second unanswered offers also re-dispatch | API guards and browser fixture flow. Exhausted candidates cancel explicitly |
| Lifecycle | Arrive/start/complete/cancel methods existed | Conditional writes, arrival required before start, busy availability protection, server-confirmed UI changes | Mocked persistence lifecycle tests, real socket transport tests |
| Real-time synchronization | Socket events and reconnect existed | Authenticated handshake/actions, participant broadcasts, active-ride snapshot on reconnect, one client socket | Real Socket.IO fixture tests pass. Multi-instance delivery not implemented |
| D1 GPS | Browser watcher existed alongside simulation fallback | Removed D1 initial coordinates and simulated fallback; secure-context guard; inaccurate/stale readings rejected; one HTTP write per reading | Eleven frontend reliability checks include GPS lifecycle and packet ordering. Actual phone GPS untested |
| Tracking/navigation | Driver-to-pickup and destination route panels | Segment-based off-route detection, real-coordinate marker interpolation, circular D1 wrapper; no recenter on every update | Browser screenshots and geometry tests. Physical navigation untested |
| D2–D8 demo | Browser and backend simulators competed | Single opt-in backend authority; validated road geometry, automatic lifecycle, cancellation checks and exact D2-D8 allowlist | Simulator fixture regressions pass; live backend OSRM read returned 63 points. Full live database demo trip remains unverified |
| Rider UI | Booking, tracking and receipt views | Honest request errors, supported product only, reduced clutter, escaped API content | Desktop browser fixture screenshots |
| Driver UI | Mobile dark dashboard | Larger touch targets, reduced map height, prominent offer/actions, decline control, waiting-for-GPS text, session earnings | 390×844 headless Edge fixture flow and overflow assertion |
| Motion/accessibility | Existing pulses/transitions | Reduced-motion CSS, keyboard focus rings, toast live roles, dialog labels, restrained panel/press animation | Static review and browser rendering; formal accessibility audit outstanding |
| Connectivity | LAN support existed; HTTPS backend mismatch | Same-origin API/socket proxy and optional trusted local TLS certificate | HTTP fixture browser run; actual certificate/device trust setup manual |
| Deployment | Build scripts and Docker service definitions | Root build covers both applications; production configuration checks; demo disabled in production | No deployment, database migration or production configuration change performed |

## Remaining product work

- Physical laptop/phone test, including permission denial, GPS loss, reconnect and a full real journey.
- Live PostgreSQL concurrency/rollback tests against a dedicated disposable test database. Current transaction tests use mocks.
- Validate the implemented offer timeout, automatic re-dispatch and unattended road-route simulator against a dedicated live database.
- Versioned migration strategy and database-level partial uniqueness for active rider/driver rides as defense in depth. Existing data must be reviewed before introducing these constraints.
- Full account onboarding/password recovery, persistent earnings/history, token revocation, shared rate limiting and multi-instance Socket.IO support.
- Production routing/geocoding capacity and availability commitments. Public demonstration providers are not a production SLA.

No payment integration or new frontend framework was added.


| Follow-up | Implementation | Verification |
| --- | --- | --- |
| Concurrent GPS packets | Atomic timestamp, location and availability-index update on standalone Redis | Memory and adapter regressions pass; real Redis integration skipped |
| Redis outage recovery | Database active ride restored with null location; explicit demo fallback and accurate health mode | HTTP regression passes; real service outage exercise outstanding |
| Demo expiration | Expired hashes, sets and values removed before reuse | Expiration regressions pass |

| Client location ordering | Preserve timestamps; reject older/duplicate/wrong-driver positions before socket-driven map updates | Three new regressions; frontend build and browser fixtures pass |


## Ride recovery and completion follow-up

The client now checks a state revision before applying a reconnect snapshot, rejects older lifecycle snapshots and backward status transitions, and remembers terminal rides during the session so delayed events cannot reopen them after dismissal. Rider cancellation records the returned terminal state before clearing the view. Driver completion events update session earnings once per ride, including when completion arrives over the socket; an explicit zero final fare is preserved.

Verification: frontend build, 14 deterministic reliability tests and both headless Edge fixture workflows passed. The three new regressions cover lifecycle rollback/terminal replay, reconnect races and duplicate completion accounting. These guards are session-local; persisted history, live integration and physical-device verification remain outstanding. Backend source was unchanged in this follow-up (previous result: 67 passed, four integration tests skipped).


Released-offer recovery: decline/timeout events and HTTP responses share a session-local release guard. Delayed offers cannot reopen released rides, and unrelated releases preserve newer offers and busy availability. Three new tests pass; frontend reliability total is 17.


Fare/search follow-up: removed the fabricated local fare fallback and default booking price. A failed server estimate clears the quote; retry obtains a quote for review before another click books it. Booking checks for changed locations. Nearby search discards responses superseded by another search or pickup change. Frontend build, 20 reliability tests and both browser fixture workflows pass; live-service and phone verification remain outstanding.
