# MIRO — Real-Time Ride-Hailing Platform (Kolkata MVP)

[![Backend Tests](https://img.shields.io/badge/backend%20tests-14%20passed-brightgreen)](#running-tests)
[![Frontend Tests](https://img.shields.io/badge/frontend%20tests-23%20passed-brightgreen)](#running-tests)
[![Geospatial Tests](https://img.shields.io/badge/geospatial%20tests-31%20passed-brightgreen)](#running-tests)

A full-stack, real-time ride-hailing MVP built with **Node.js, Express, TypeScript, Socket.IO, PostgreSQL, Redis, Leaflet, and Uber H3 spatial indexing**, localized for Kolkata, West Bengal.

MIRO handles real-time driver tracking, nearest-driver spatial matching, and the complete ride lifecycle for:
- **1 Real Rider**: Booking and tracking rides in real-time via the web interface.
- **1 Real Driver (D1)**: Broadcasting authenticated physical GPS telemetry from an Android smartphone over trusted HTTPS/WSS.
- **7 Simulated Background Drivers (D2–D8)**: Auto-started background fleet moving along road-accurate waypoints in Kolkata, updating through Redis and participating in H3 spatial matching.

> **Physical Android GPS Setup:** See [NETWORK_SETUP.md](NETWORK_SETUP.md) for local network configuration, trusted CA certificate installation (`mkcert`), and mobile diagnostics.

---

## Table of Contents
- [Tech Stack](#tech-stack)
- [Key Architectural Decisions](#key-architectural-decisions)
  - [Why Redis for Live Locations?](#why-redis-for-live-locations)
  - [Why Uber H3 for Spatial Indexing?](#why-uber-h3-for-spatial-indexing)
  - [Dual Driver Model (Real D1 vs Simulated D2–D8)](#dual-driver-model-real-d1-vs-simulated-d2d8)
- [How Spatial Matching Works](#how-spatial-matching-works)
- [System Architecture](#system-architecture)
- [Developer Diagnostics Dashboard](#developer-diagnostics-dashboard)
- [Getting Started](#getting-started)
  - [1. Prerequisites](#1-prerequisites)
  - [2. Start PostgreSQL & Redis Containers](#2-start-postgresql--redis-containers)
  - [3. Install Dependencies](#3-install-dependencies)
  - [4. Environment Configuration](#4-environment-configuration)
  - [5. Database Schema & Seed Data](#5-database-schema--seed-data)
  - [6. Start the Full Application](#6-start-the-full-application)
- [Default Demo Credentials](#default-demo-credentials)
- [Running Tests](#running-tests)
- [API & WebSocket Overview](#api--websocket-overview)
- [Documentation Reference](#documentation-reference)

---

## Tech Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Backend Runtime** | Node.js (v20+) & TypeScript | Strongly-typed backend service |
| **HTTP Framework** | Express 4 | REST API routing and middleware |
| **Real-Time WebSockets** | Socket.IO 4 | Low-latency bi-directional GPS streaming and ride lifecycle events |
| **Relational Database** | PostgreSQL 16 + PostGIS | ACID storage for users, vehicles, drivers, and immutable completed rides |
| **ORM** | Prisma 5 | Type-safe database queries and migrations |
| **In-Memory Store** | Redis 7 (`ioredis`) | High-throughput transient GPS caches, online sets, and H3 cell indexes |
| **Spatial Indexing** | Uber `h3-js` (Resolution 8) | Discrete global hexagonal grid for nearest-driver radial search |
| **Validation** | Zod | Runtime payload verification for HTTP and WebSocket events |
| **Frontend** | Vanilla JS & Vite | Responsive mobile-first UI with Leaflet interactive maps and OSRM routing |

---

## Key Architectural Decisions

### Why Redis for Live Locations?
In ride-hailing platforms, active drivers broadcast GPS telemetry every 2–3 seconds. Writing each coordinate directly to a relational database creates extreme disk I/O, write-lock contention, and rapid table bloat.

Instead, transient driver locations are stored in Redis using key hashes (`driver:location:<id>`) and spatial set memberships (`h3:<cell_id>:drivers`). Redis operates in-memory with sub-millisecond latency. Driver locations reside in Redis while active, and only durable business state transitions and completed ride receipts are committed to PostgreSQL.

### Why Uber H3 for Spatial Indexing?
Uber H3 divides the globe into a discrete hexagonal hierarchical grid. MIRO operates at **Resolution 8**, where each hexagonal cell spans ~0.74 km² with an edge length of ~460 meters:
- **Equidistant Neighbors**: Unlike square grids where diagonals are $\sqrt{2}\times$ further away, all 6 neighbors of a hexagon share identical centroid-to-centroid distances.
- **Concentric Ring Expansion**: Expanding search rings ($k=0, 1, 2, \dots$) radiates outward in circular tiers.
- **O(1) Set Lookups**: Drivers map directly to cell index strings in Redis sets, completely bypassing full-table geospatial coordinate scans.

### Dual Driver Model (Real D1 vs Simulated D2–D8)
Testing multi-driver spatial dispatch typically requires several physical smartphones moving across a city. MIRO solves this using a strict dual-driver architecture:
1. **Real Driver (D1)**: Reserved strictly for a physical mobile phone. Coordinates arrive from the device's Geolocation API over HTTPS/WSS. D1 is **never** automated or snapped by the simulator.
2. **Simulated Drivers (D2–D8)**: Auto-started on backend launch in development (`DEMO_MODE=true`). They progress along real road segments in Kolkata, push updates to Redis and Socket.IO, and participate in H3 matching on equal footing with D1.

---

## How Spatial Matching Works

```
Rider Pickup Coordinates (lat, lng)
           │
           ▼
Convert GPS to H3 Cell (Resolution 8)
           │
           ▼
Expand concentric k-rings outward (k = 0, 1, 2...)
           │
           ▼
Retrieve Driver IDs from Redis sets: `h3:<cell_id>:drivers`
           │
           ▼
Filter drivers by status (`ONLINE` and not `IN_RIDE`) & freshness (< 60s)
           │
           ▼
Retrieve driver locations from Redis: `driver:location:<id>`
           │
           ▼
Calculate Haversine distance & ETA to pickup
           │
           ▼
Sort ascending by distance & assign the nearest eligible candidate
```

---

## System Architecture

```
                       +-----------------------+
                       | Real Rider Client /   |
                       | Real Driver D1 (Phone)|
                       +-----------+-----------+
                                   |
                                   | HTTPS / WebSocket (WSS)
                                   v
+------------------+     +---------+-----------+
| 7-Driver         |---->|  Express HTTP &     |
| Simulator (D2-D8)|     |  Socket.IO Server   |
+------------------+     +----+-----------+----+
                               |           |
            +------------------+           +------------------+
            |                                                 |
            v                                                 v
+-----------+-----------+                         +-----------+-----------+
|      Redis 7          |                         |   PostgreSQL 16       |
| (localhost:6380)      |                         |   (localhost:5433)    |
| - driver:location:<id>|                         | - Users & Auth        |
| - drivers:online      |                         | - Drivers & Vehicles  |
| - h3:<cell_id>:drivers|                         | - Rides & Receipts    |
| - ride:<id>:state     |                         | - Prisma Migrations   |
+-----------------------+                         +-----------------------+
```

---

## Developer Diagnostics Dashboard

A built-in developer dashboard is available for real-time fleet observation and matching verification:

- **URL**: `http://localhost:3000/dashboard`
- **Features**:
  - Live Leaflet map centered on Central Kolkata (`22.5646, 88.3510`).
  - Real-time pins for real driver D1 (blue) and simulated fleet D2–D8 (gold/gray).
  - Interactive H3 hexagonal cell overlays showing active driver distribution.
  - Live connectivity badges (Backend, Redis, PostgreSQL, Socket.IO, Simulator).
  - One-click spatial lookup test returning the Top 8 candidate drivers ranked by pickup distance.

---

## Getting Started

### 1. Prerequisites
- **Node.js**: v20 or higher (`node -v`)
- **Docker Desktop**: Running locally (`docker ps`)
- **mkcert** *(optional, for phone testing)*: For trusted LAN SSL certificates

### 2. Start PostgreSQL & Redis Containers
MIRO uses dedicated ports to prevent host service collisions:
- **PostgreSQL**: Port `5433`
- **Redis**: Port `6380`

```powershell
# From the project root
cd backend
docker compose up -d
cd ..
```

Verify the containers are healthy:
```powershell
docker ps --filter "name=uber"
```

### 3. Install Dependencies
```powershell
# Install root, backend, and frontend packages
npm install
npm --prefix backend install
npm --prefix frontend install
```

### 4. Environment Configuration
Ensure `backend/.env` is configured (matches Docker ports):
```env
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgrespassword@localhost:5433/uber_db?schema=public
REDIS_URL=redis://localhost:6380
JWT_SECRET=super_secret_jwt_key_for_uber_mvp_2026
H3_RESOLUTION=8
MAX_CANDIDATE_DRIVERS=8
SIMULATOR_NUM_DRIVERS=7
DEMO_MODE=true
CENTER_LAT=22.5646
CENTER_LNG=88.3510
```

### 5. Database Schema & Seed Data
Initialize the database tables and demo accounts:
```powershell
npm --prefix backend run prisma:push
npm --prefix backend run prisma:seed
```

### 6. Start the Full Application
Start both the backend service and Vite frontend together:
```powershell
# Production build check
npm run build

# Start both services concurrently
npm run start:dev
```
- **Rider & Driver App**: `https://localhost:5173` (or `https://<YOUR_LAN_IP>:5173`)
- **Backend API**: `http://localhost:3000`
- **Fleet Diagnostics Dashboard**: `http://localhost:3000/dashboard`

---

## Default Demo Credentials

All test accounts share the password: `Password123!`

| Role | Name | Email | Details |
| :--- | :--- | :--- | :--- |
| **Rider** | Saptarshi Roy | `rider@demo.com` | Test rider in Kolkata |
| **Driver 1 (Real)** | Debashis Mukherjee | `driver1@demo.com` | Physical Android GPS driver |
| **Driver 2 (Simulated)** | Rajesh Sharma | `driver2@demo.com` | Auto-simulated sedan |
| **Driver 3 (Simulated)** | Amit Patel | `driver3@demo.com` | Auto-simulated sedan |
| **Driver 4 (Simulated)** | Sneha Banerjee | `driver4@demo.com` | Auto-simulated SUV |
| **Driver 5 (Simulated)** | Vikram Singh | `driver5@demo.com` | Auto-simulated sedan |
| **Driver 6 (Simulated)** | Pooja Das | `driver6@demo.com` | Auto-simulated sedan |
| **Driver 7 (Simulated)** | Rahul Ghosh | `driver7@demo.com` | Auto-simulated SUV |
| **Driver 8 (Simulated)** | Ananya Sen | `driver8@demo.com` | Auto-simulated sedan |

---

## Running Tests

MIRO includes automated test suites covering backend unit/integration logic, frontend reliability, geospatial math, and headless browser workflows:

```powershell
# 1. Run root backend & frontend unit test suites (109 tests)
npm test

# 2. Run live frontend geospatial & OSRM routing tests (31 tests)
npm --prefix frontend test

# 3. Run headless browser CDP test (Edge/Chrome automation)
npm --prefix frontend run test:browser

# 4. Run authoritative live ride lifecycle verification
npx --prefix backend jest tests/live_lifecycle.test.ts
```

---

## API & WebSocket Overview

### REST Endpoints (`/api/v1`)
- `POST /api/v1/auth/login` - Authenticate and receive JWT session
- `GET /api/v1/drivers/nearby?latitude=...&longitude=...&radiusKm=8` - Top 8 nearest drivers via H3
- `POST /api/v1/rides/estimate` - Fare estimate based on pickup and destination
- `POST /api/v1/rides` - Request a ride and assign closest eligible driver
- `GET /api/v1/rides/:id` - Fetch live ride state and driver telemetry
- `PATCH /api/v1/rides/:id/accept` - Driver accepts ride offer
- `PATCH /api/v1/rides/:id/arrive` - Driver marks arrived at pickup
- `PATCH /api/v1/rides/:id/start` - Driver begins the trip
- `PATCH /api/v1/rides/:id/complete` - Driver completes trip and finalizes fare
- `PATCH /api/v1/rides/:id/cancel` - Cancel active ride request
- `GET /api/v1/system/status` - Health check and simulator diagnostics

### WebSocket Events (`Socket.IO`)
| Event | Direction | Payload Description |
| :--- | :--- | :--- |
| `driver:location` | Driver → Server | Authenticated GPS reading `{ driverId, latitude, longitude, heading, speed }` |
| `driver:online` | Driver → Server | Mark driver availability online |
| `driver:offline` | Driver → Server | Mark driver availability offline |
| `location:update` | Server → Rider/Fleet | High-frequency coordinate broadcast for map marker positioning |
| `ride:status_changed` | Server → All | Broadcast of ride state machine updates |

---

## Documentation Reference

- **[NETWORK_SETUP.md](NETWORK_SETUP.md)**: Mobile Android HTTPS trust setup, local IP binding, and troubleshooting.
- **[docs/API.md](docs/API.md)**: Detailed REST API endpoint specification.
- **[docs/WEBSOCKET.md](docs/WEBSOCKET.md)**: WebSocket protocols, event payloads, and rate limits.
- **[docs/MATCHING.md](docs/MATCHING.md)**: H3 resolution calculations and nearest-driver dispatch policy.
- **[docs/DATABASE.md](docs/DATABASE.md)**: PostgreSQL schemas, Prisma models, and Redis keyspace design.
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**: Component interactions and lifecycle state machines.
- **[docs/PHYSICAL_DEVICE_TEST_CHECKLIST.md](docs/PHYSICAL_DEVICE_TEST_CHECKLIST.md)**: Step-by-step checklist for real phone field testing.
