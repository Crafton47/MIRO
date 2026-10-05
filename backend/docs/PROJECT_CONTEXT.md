# Uber-Style Ride-Hailing MVP Backend - Project Context

## 1. Project Purpose
The goal of this project is to build an Uber-style ride-hailing backend MVP for a college project demo (deadline: Oct 10).
The demo will feature:
- 1 real rider
- 1 real driver (phone GPS)
- 7 simulated drivers (D2..D8) using the exact same backend location/update pipeline
- H3-based geographic indexing (resolution 8)
- Real-time driver location updates & Redis geospatial cache
- Top 8 driver matching based on H3 spatial lookup & proximity/ETA ranking
- Complete ride lifecycle (Request -> Accept -> Start -> Complete / Cancel)
- Basic fare calculation
- PostgreSQL + PostGIS persistent storage (Prisma ORM)

## 2. Core Architecture
- **API & App Layer**: Node.js, Express, TypeScript
- **Real-Time Pipeline**: Socket.IO / WebSockets (driver high-frequency GPS -> WebSocket -> H3 cell index -> Redis)
- **Geospatial Indexing**: Uber H3 (resolution 8)
- **Live State Store**: Redis (driver locations `driver:location:<id>`, availability, H3 cell to driver mappings `h3:<cell_id>:drivers`, active ride states `ride:<id>:state`)
- **Persistent Data Store**: PostgreSQL + PostGIS (Users, Drivers, Vehicles, Rides)
- **Driver Simulator**: Embedded backend service / client generating 7 realistic driver updates over WebSocket

```
Clients (Rider / Driver / Simulator)
        |
        | REST API + WebSocket
        v
Backend (Node.js + Express + Socket.IO + TypeScript)
        |
        +-- Auth Service
        +-- Driver Service
        +-- Location Service
        +-- Matching Service (H3 + Ranking)
        +-- H3 Service
        +-- Fare Service
        +-- Ride State Machine
        +-- Driver Simulator (7 drivers)
        |
    +---+-------------------+
    |                       |
    v                       v
PostgreSQL + PostGIS     Redis
(Persistent DB)          (Live locations, H3 maps, active states)
```

## 3. Technology Stack
- **Language**: TypeScript 5.x
- **Runtime**: Node.js 25.x
- **Web Framework**: Express 4.x
- **Realtime**: Socket.IO 4.x
- **Database**: PostgreSQL 16 + PostGIS extension
- **ORM**: Prisma ORM 5.x
- **In-Memory Cache**: Redis / ioredis (with in-memory fallback for local unit tests)
- **Spatial Indexing**: `h3-js`
- **Validation**: Zod schema validation
- **Auth**: JWT (JSON Web Tokens) + bcryptjs
- **Testing**: Jest / Supertest

## 4. Directory Structure
```
Uber/
├── backend/
│   ├── src/
│   │   ├── config/             # DB, Redis, App configs
│   │   ├── controllers/        # REST API controllers
│   │   ├── routes/             # Express API routes (/api/v1)
│   │   ├── services/           # Core business logic
│   │   │   ├── auth/           # Auth service (JWT/hashing)
│   │   │   ├── driver/         # Driver status & CRUD
│   │   │   ├── ride/           # Ride lifecycle & state machine
│   │   │   ├── matching/       # H3 nearby + top 8 candidate search
│   │   │   ├── location/       # Driver GPS ingestion & Redis mapping
│   │   │   ├── h3/             # H3 conversion & k-ring spatial helpers
│   │   │   ├── fare/           # Distance/time fare calculator
│   │   │   └── simulator/      # 7-driver simulator engine
│   │   ├── websocket/          # Socket.IO handlers & event emitters
│   │   ├── middleware/         # Centralized error handler, auth middleware
│   │   ├── validators/         # Zod schemas for REST & WS payloads
│   │   ├── utils/              # Distance/haversine math, logger, AppError
│   │   ├── types/              # Express/Socket TypeScript definitions
│   │   ├── app.ts              # Express application setup
│   │   └── server.ts           # HTTP & Socket.IO server initialization
│   ├── public/                 # Static assets & Developer Dashboard (/dashboard)
│   ├── prisma/
│   │   └── schema.prisma       # Database schema & migrations
│   ├── simulator/              # Simulator CLI/runner
│   ├── tests/                  # Unit and integration test suites
│   ├── docs/                   # System & API documentation
│   ├── .env.example            # Environment variables blueprint
│   ├── docker-compose.yml      # Docker compose for PostgreSQL, PostGIS, Redis
│   ├── package.json
│   └── tsconfig.json
└── docs/                       # Project documentation
```

## 5. Database & Redis Design
### PostgreSQL Entities
- `User`: id, name, phone, email, passwordHash, role (`RIDER`, `DRIVER`, `ADMIN`), createdAt, updatedAt
- `Driver`: id, userId, status (`OFFLINE`, `ONLINE`, `IN_RIDE`), rating, createdAt, updatedAt
- `Vehicle`: id, driverId, vehicleType, model, numberPlate, createdAt, updatedAt
- `Ride`: id, riderId, driverId, status (`REQUESTED`, `SEARCHING`, `DRIVER_ASSIGNED`, `DRIVER_ARRIVING`, `DRIVER_ARRIVED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`), pickupLat, pickupLng, destLat, destLng, pickupAddress, destAddress, distanceKm, durationMin, estimatedFare, finalFare, startedAt, completedAt, cancelledAt, createdAt, updatedAt

### Redis Key Schema
- `driver:location:<driverId>` -> `{ driverId, lat, lng, h3Index, status, updatedAt }` (Hash or JSON string with TTL)
- `driver:status:<driverId>` -> `ONLINE` | `OFFLINE` | `IN_RIDE`
- `h3:<h3Index>:drivers` -> Set of active `driverId`s in that H3 hex
- `ride:<rideId>:state` -> Active state metadata

## 6. H3 Matching Design
- Driver GPS updates -> convert to H3 resolution 8 index (hex radius ~460m).
- Store `driverId` in Redis Set `h3:<cell_id>:drivers`.
- On Ride Request:
  1. Convert Pickup GPS -> Rider H3 Cell.
  2. Perform k-ring search (k=0, 1, 2, 3...) to cover surrounding hexes until candidates found.
  3. Query Redis Sets for available drivers in those hexes.
  4. Calculate straight-line distance (haversine) / estimated ETA.
  5. Rank candidates by shortest distance/ETA.
  6. Return top 8 available candidate drivers.

## 7. WebSocket Protocol & Payload Specification
- `driver:location`: `{ driverId, latitude, longitude, heading, speed }`
- `driver:online`: `{ driverId }`
- `driver:offline`: `{ driverId }`
- `driver:matched`: `{ driverId, rideId }`
- `ride:request`: `{ rideId, pickupLat, pickupLng, destLat, destLng }`
- `ride:accepted`: `{ rideId, driverId }`
- `ride:started`: `{ rideId, driverId }`
- `ride:completed`: `{ rideId, driverId, finalFare }`
- `ride:cancelled`: `{ rideId, cancelledBy, reason }`
- `location:update`: `{ entityType: 'DRIVER' | 'RIDER', entityId, latitude, longitude }`

## 8. Current Implementation Status
- **Status**: Completed & Verified
- **Completed**:
  - Consolidated into single `Uber` project directory (`c:\Uber`)
  - Full TypeScript & Express server setup
  - PostgreSQL, PostGIS & Prisma schema + seed script
  - Redis live location & H3 spatial index sets
  - Socket.IO location pipeline
  - H3 matching engine (Top 8 drivers)
  - 7-Driver realistic movement simulator
  - Ride lifecycle state machine & REST endpoints
  - Unit & Integration test suite passing 100%
  - Developer Monitoring Dashboard (`http://localhost:3000/dashboard`) for real-time visual inspection of D1..D8 movement, H3 hexagons, Redis health, and ride matching candidate ranking

