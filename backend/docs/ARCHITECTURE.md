# System Architecture - Uber-Style Ride-Hailing MVP

## Architectural Overview

The backend system is designed around a high-frequency real-time location pipeline and low-frequency persistent application database.

```
       +-----------------------+      +-----------------------+
       |   Real Driver App     |      |   Simulated Drivers   |
       |  (Phone GPS / WS)     |      | (7 Drivers - D2..D8)  |
       +-----------+-----------+      +-----------+-----------+
                   |                              |
                   +--------------+---------------+
                                  |
                                  v
                        WebSocket Connection
                                  |
                                  v
                      +-----------------------+
                      |   Node.js Backend     |
                      |  (Express + SocketIO) |
                      +-----------+-----------+
                                  |
             +--------------------+--------------------+
             |                                         |
             v                                         v
   +-------------------+                     +-------------------+
   |   Redis Cache     |                     | PostgreSQL/PostGIS|
   | (Live Locations,  |                     | (Users, Drivers,  |
   | H3 Index Sets,    |                     | Vehicles, Rides,  |
   | Active States)    |                     | Persistence)      |
   +-------------------+                     +-------------------+
```

## Key Architectural Rules

1. **High-Frequency Data Isolation**: Driver GPS updates (emitted every 1-5 seconds) are sent strictly via WebSockets, converted to Uber H3 resolution 8 indices, and stored in **Redis**. They are **NEVER** written directly to PostgreSQL on every ping.
2. **Unified Pipeline**: Simulated drivers (D2..D8) and the real driver (D1) connect over the exact same WebSocket event contract (`driver:location`). The backend does not distinguish between simulated and real drivers.
3. **Decoupled Business Logic**: REST APIs handle auth, driver registration, ride lifecycle commands, and fare estimation. Socket.IO handles real-time spatial updates, dispatch notifications, and live status broadcasts.
4. **Resilient Matching**: H3 resolution 8 cells provide spatial candidate filtering (~460m hexes). Surrounding hexes (k-ring search) are scanned for active drivers in Redis, followed by proximity & ETA sorting.
