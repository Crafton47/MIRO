# Uber-Style Ride-Hailing Backend (MVP)

A modular ride-hailing backend MVP built with Node.js, Express, TypeScript, Socket.IO, PostgreSQL, Redis, and Uber H3 spatial indexing.

This project was developed for a college capstone/demo. It handles real-time driver tracking, spatial matching, and the complete ride lifecycle for a real rider, a real driver sending live GPS from a smartphone, and 7 simulated background drivers.

---

## Table of Contents
- [What the Project Does](#what-the-project-does)
- [Tech Stack](#tech-stack)
- [Key Design Decisions](#key-design-decisions)
  - [Why Redis for Live Locations?](#why-redis-for-live-locations)
  - [Why Uber H3 for Spatial Indexing?](#why-uber-h3-for-spatial-indexing)
  - [Why PostgreSQL for Persistent Data?](#why-postgresql-for-persistent-data)
  - [Why Simulate Drivers D2–D8?](#why-simulate-drivers-d2d8)
- [How Matching Works](#how-matching-works)
- [System Architecture](#system-architecture)
- [Developer Monitoring Dashboard](#developer-monitoring-dashboard)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [1. Start Database & Redis](#1-start-database--redis)
  - [2. Install Dependencies](#2-install-dependencies)
  - [3. Configure Environment Variables](#3-configure-environment-variables)
  - [4. Setup Database Schema & Seed Data](#4-setup-database-schema--seed-data)
  - [5. Run the Backend](#5-run-the-backend)
- [Running the Simulator](#running-the-simulator)
- [Running Tests](#running-tests)
- [API & WebSocket Overview](#api--websocket-overview)

---

## What the Project Does

The backend coordinates the core workflows of an on-demand ride-hailing platform:

1. **Driver Ingestion & Tracking**: Ingests GPS telemetry over WebSockets (Socket.IO) and indexes driver locations into spatial hexagonal cells in real time.
2. **Driver Availability**: Tracks driver states (`ONLINE`, `OFFLINE`, `IN_RIDE`) in memory with immediate updates broadcast across the system.
3. **Spatial Driver Matching**: Finds and ranks the top 8 nearest available drivers around a rider's pickup location using Uber H3 hexagonal rings and haversine distance.
4. **Ride Lifecycle State Machine**: Manages strict ride transitions:
   `REQUESTED` → `SEARCHING` → `DRIVER_ASSIGNED` → `DRIVER_ARRIVING` → `DRIVER_ARRIVED` → `IN_PROGRESS` → `COMPLETED` (or `CANCELLED`).
5. **Fare Calculation**: Calculates fares based on base fare, distance traveled, and duration.
6. **Multi-Driver Fleet**: Supports 1 real driver (D1) connected via smartphone WebSocket alongside 7 simulated drivers (D2–D8) moving along realistic paths.

---

## Tech Stack

| Component | Technology | Role |
| :--- | :--- | :--- |
| **Runtime & Language** | Node.js (v20+) & TypeScript | Strongly-typed backend service |
| **HTTP Framework** | Express 4 | REST API routing and middleware |
| **Real-Time Layer** | Socket.IO 4 | Bidirectional WebSocket communication for GPS and ride events |
| **Relational Database** | PostgreSQL 16 + PostGIS | Persistent storage for users, drivers, vehicles, and rides |
| **ORM** | Prisma 5 | Schema modeling, migrations, and database queries |
| **In-Memory Store** | Redis 7 (`ioredis`) | High-frequency driver GPS, H3 cell sets, and active ride state |
| **Spatial Indexing** | `h3-js` (Resolution 8) | Hexagonal spatial indexing and k-ring candidate searches |
| **Validation** | Zod | Runtime request and payload validation |
| **Testing** | Jest & Supertest | Unit, integration, and API contract test suites |

---

## Key Design Decisions

### Why Redis for Live Locations?
In ride-hailing systems, active drivers emit GPS updates every 2 to 4 seconds. Writing every update directly to a relational database like PostgreSQL causes high disk I/O, write lock contention, and rapid table bloat.

Instead, transient driver locations are stored in Redis using key hashes (`driver:location:<id>`) and set memberships (`h3:<cell_id>:drivers`). Redis operates in-memory with sub-millisecond latency, making it ideal for high-throughput location updates. Driver locations are kept in Redis while active, and only completed ride summaries and durable state changes are persisted to PostgreSQL.

### Why Uber H3 for Spatial Indexing?
Uber H3 divides the surface of the earth into a discrete global grid of hexagons. We use **Resolution 8**, where each hexagonal cell has an average area of ~0.74 km² and an edge length of approximately 460 meters.

Hexagons have unique geometric advantages over square grids:
- All neighboring hexagons share identical centroid-to-centroid distances.
- K-ring expansion (`gridDisk(originCell, k)`) expands concentrically outward in clean circular tiers.
- Drivers are mapped directly to an H3 cell index string. Finding candidate drivers simply requires reading the driver IDs stored in the Redis set for that cell and its neighboring rings, avoiding expensive full-table distance scans.

### Why PostgreSQL for Persistent Data?
PostgreSQL provides ACID transactions and strict referential integrity for entities that must survive server restarts:
- User accounts (riders and drivers) with hashed passwords.
- Driver profiles and vehicle records.
- Completed ride records, billing receipts, and timestamps.
- PostGIS extensions provide spatial capabilities for auditing or historical geospatial queries.

### Why Simulate Drivers D2–D8?
Testing an on-demand matching system with multiple drivers normally requires 8 physical smartphones moving simultaneously in different locations.

To enable realistic testing and classroom demonstrations with a single laptop and one smartphone:
- **D1** is reserved for the real driver (connected via phone browser or mobile app).
- **D2 through D8** are simulated background drivers that generate realistic telemetry.
- **Identical Pipeline**: The simulator emits the exact same WebSocket payloads (`driver:location`) to the backend as a real phone. The backend treats simulated drivers identically to real drivers.

---

## How Matching Works

When a rider requests a ride:

```
Rider Pickup GPS (lat, lng)
           │
           ▼
Convert GPS to H3 Cell (Resolution 8)
           │
           ▼
Expand k-ring outward (k = 0, 1, 2, 3...)
           │
           ▼
Fetch Driver IDs from Redis sets: `h3:<cell_id>:drivers`
           │
           ▼
Filter drivers by availability (`ONLINE` and not `IN_RIDE`)
           │
           ▼
Fetch each driver's live GPS from Redis: `driver:location:<id>`
           │
           ▼
Calculate Haversine distance & estimated ETA
           │
           ▼
Sort by shortest distance / ETA
           │
           ▼
Return Top 8 Candidate Drivers
```

1. **Pickup Cell**: The pickup coordinates are converted to an H3 resolution 8 cell.
2. **Ring Search**: The algorithm queries the center cell ($k=0$). If fewer candidates are found than desired, it expands to concentric rings ($k=1, 2, ...$) up to a maximum radius.
3. **Candidate Retrieval**: Driver IDs indexed in those cells are retrieved from Redis sets.
4. **Availability Filter**: Drivers are checked to confirm they are `ONLINE` and not already assigned to another ride.
5. **Ranking**: The haversine formula calculates straight-line distance from the pickup point. Candidates are sorted ascending by distance, and the top 8 are returned.

---

## System Architecture

```
                       +-----------------------+
                       | Real Rider Client /   |
                       | Real Driver D1 (Phone)|
                       +-----------+-----------+
                                   |
                                   | HTTP / WebSocket
                                   v
+------------------+     +---------+-----------+
| 7-Driver         |---->|  Express HTTP &     |
| Simulator (D2-D8)|     |  Socket.IO Server   |
+------------------+     +----+-----------+----+
                              |           |
            +-----------------+           +-----------------+
            |                                               |
            v                                               v
+-----------+-----------+                       +-----------+-----------+
|      Redis 7          |                       |   PostgreSQL 16       |
| (localhost:6380)      |                       |   (localhost:5433)    |
|                       |                       |                       |
| - driver:location:<id>|                       | - Users (Rider/Driver)|
| - driver:status:<id>  |                       | - Drivers & Vehicles  |
| - h3:<cell_id>:drivers|                       | - Rides (Persistent)  |
| - ride:<id>:state     |                       | - Prisma Migrations   |
+-----------------------+                       +-----------------------+
```

---

## Developer Monitoring Dashboard

A lightweight, built-in developer dashboard is included for visually demonstrating and debugging the backend in real time.

- **URL**: `http://localhost:3000/dashboard`
- **Features**:
  - Interactive Leaflet map centered on the operational area (Hyderabad / Hitec City).
  - Real-time driver markers for D1 (real) and D2–D8 (simulated) updating via live WebSockets.
  - Interactive H3 hexagonal cell overlays showing active driver counts per cell.
  - Live system connectivity badges (Backend, Redis, PostgreSQL, Socket.IO).
  - Simulator control (Start / Stop 7-driver simulation directly from the browser).
  - Test rider matching simulation: Click anywhere on the map to set a pickup location and visualize the top ranked candidate drivers.

---

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or v20+ recommended)
- [Docker & Docker Compose](https://www.docker.com/)

### 1. Start Database & Redis
The repository includes a `docker-compose.yml` configured to avoid port conflicts with host services:
- PostgreSQL runs on host port **5433** (maps to internal 5432)
- Redis runs on host port **6380** (maps to internal 6379)

```bash
cd backend
docker-compose up -d
```

Verify containers are running:
```bash
docker ps
```

### 2. Install Dependencies
```bash
cd backend
npm install
```

### 3. Configure Environment Variables
Copy `.env.example` to `.env` if not already present:
```bash
cp .env.example .env
```

Ensure the connection strings match the Docker Compose port mappings:
```env
PORT=3000
NODE_ENV=development
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/uber_db?schema=public"
REDIS_URL="redis://localhost:6380"
JWT_SECRET="your-super-secret-jwt-key"
```

### 4. Setup Database Schema & Seed Data
Push the schema to PostgreSQL and seed initial test accounts:
```bash
npx prisma db push
npx prisma db seed
```

This seeds:
- Test Rider (`rider@uber.local` / `password123`)
- Real Driver D1 (`driver1@uber.local` / `password123`)
- Simulated Drivers D2 through D8 with vehicle records

### 5. Run the Backend
Start the server in development mode (with auto-reload):
```bash
npm run dev
```

The server will start on `http://localhost:3000`.
- Health check: `http://localhost:3000/health`
- System status: `http://localhost:3000/api/v1/system/status`
- Monitoring Dashboard: `http://localhost:3000/dashboard`

---

## Running the Simulator

The simulator moves drivers D2 through D8 along realistic waypoint loops, emitting coordinates over WebSocket every 3 seconds.

You can run it in two ways:

**Option A: Through the Developer Dashboard**
Open `http://localhost:3000/dashboard` and click **"Start Simulator"**.

**Option B: Via CLI**
In a separate terminal window:
```bash
cd backend
npm run simulator
```

---

## Running Tests

The test suite covers unit logic, H3 spatial calculations, fare estimation, and end-to-end ride lifecycle state transitions:

```bash
cd backend

# Run all test suites
npm test

# Run tests with coverage
npm run test:coverage

# Run TypeScript type check
npx tsc --noEmit

# Validate production build
npm run build
```

---

## API & WebSocket Overview

### Core REST Endpoints (`/api/v1`)
- `POST /auth/register` - Create rider or driver account
- `POST /auth/login` - Authenticate and receive JWT
- `GET /drivers/nearby?latitude=...&longitude=...` - Query top 8 candidate drivers via H3
- `PATCH /drivers/:id/status` - Update driver availability status
- `POST /rides` - Request a new ride
- `GET /rides/:id` - Fetch ride details and status
- `PATCH /rides/:id/accept` - Driver accepts a ride
- `PATCH /rides/:id/start` - Driver starts the trip
- `PATCH /rides/:id/complete` - Driver completes the trip and finalizes fare
- `PATCH /rides/:id/cancel` - Cancel a ride
- `GET /system/status` - Connectivity health for Redis, PostgreSQL, and Socket.IO

### WebSocket Events (`Socket.IO`)
| Event | Direction | Payload Description |
| :--- | :--- | :--- |
| `driver:location` | Client → Server | Driver GPS update `{ driverId, latitude, longitude, heading, speed }` |
| `driver:online` | Client → Server | Driver marks status as online `{ driverId }` |
| `driver:offline` | Client → Server | Driver marks status as offline `{ driverId }` |
| `driver:matched` | Server → Driver | Notifies matched driver of a ride request `{ driverId, rideId }` |
| `ride:request` | Client → Server | Rider requests ride `{ rideId, pickupLat, pickupLng, destLat, destLng }` |
| `ride:accepted` | Client → Server | Driver accepts ride `{ rideId, driverId }` |
| `ride:started` | Client → Server | Trip begins `{ rideId, driverId }` |
| `ride:completed` | Client → Server | Trip finishes `{ rideId, driverId, finalFare }` |
| `ride:cancelled` | Client → Server | Trip cancelled `{ rideId, cancelledBy, reason }` |
| `location:update` | Server → All | Broadcast of updated coordinates for map display |
| `ride:status_changed` | Server → All | Broadcast when a ride changes state |
