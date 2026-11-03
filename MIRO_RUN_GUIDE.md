# MIRO RUN & OPERATIONAL GUIDE

This guide provides exact, verified Windows PowerShell instructions to run the MIRO ride-hailing platform for MVP demonstrations and local testing.

---

## 1. Prerequisites Check

Before starting, verify your environment:

```powershell
# Check Node.js and npm versions
node --version   # Must be >= v20 (verified on v25.6.0)
npm --version    # Verified on 11.8.0

# Verify Docker Desktop is running
docker ps
```

---

## 2. Infrastructure Setup (PostgreSQL & Redis)

MIRO uses PostgreSQL 16 (with PostGIS) on port **5433** and Redis 7 on port **6380** (to avoid conflicts with standard ports):

### Start Database Containers (if not already running)

```powershell
# Verify status of existing uber containers
docker ps --filter "name=uber"

# If stopped, start them:
docker start uber_postgres uber_redis

# Or start fresh with docker-compose:
Set-Location "c:\Users\Shaya\Downloads\MIRO-tested-partial-fixes\MIRO-main\backend"
docker compose up -d
```

### Configure Environment Files

Ensure `backend/.env` exists with the verified connection settings:

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
```

Ensure `frontend/.env` exists:

```env
VITE_API_URL=
VITE_WS_URL=
VITE_ROUTING_API_URL=https://router.project-osrm.org
VITE_GEOCODING_SEARCH_URL=https://photon.komoot.io/api/
VITE_GEOCODING_REVERSE_URL=https://photon.komoot.io/reverse
VITE_GEOCODING_API_KEY=
```

---

## 3. Trusted HTTPS Setup (Required for Physical Phone GPS)

The HTML5 Geolocation API requires a secure context (HTTPS) when accessed over a local Wi-Fi network:

```powershell
Set-Location "c:\Users\Shaya\Downloads\MIRO-tested-partial-fixes\MIRO-main"

# Generate local CA and certificates for your Wi-Fi LAN IP
npm run setup:https
```

This generates:
- `.certs/miro.pem` and `.certs/miro-key.pem` (Vite TLS certificates)
- `.certs/network.json` (Stores current LAN IP and mobile URL)
- `.certs/phone-rootCA.crt` (Root CA certificate to transfer to the Android phone)

---

## 4. Launching the Application

### Option A: Unified Launcher (Recommended)

Starts both backend and frontend concurrently with port checks:

```powershell
Set-Location "c:\Users\Shaya\Downloads\MIRO-tested-partial-fixes\MIRO-main"
$env:DEMO_MODE = 'true'
npm run dev
```

### Option B: Separate Terminals

**Terminal 1 — Backend Server:**
```powershell
Set-Location "c:\Users\Shaya\Downloads\MIRO-tested-partial-fixes\MIRO-main\backend"
$env:NODE_ENV = 'development'
$env:DEMO_MODE = 'true'
npm run dev
```
Backend will listen at: `http://localhost:3000` (and `http://<LAN_IP>:3000`)

**Terminal 2 — Frontend Dev Server:**
```powershell
Set-Location "c:\Users\Shaya\Downloads\MIRO-tested-partial-fixes\MIRO-main\frontend"
npm run dev
```
Frontend will listen at: `https://localhost:5173` (and `https://<LAN_IP>:5173`)

---

## 5. Running the Test Suites

To run all automated verification suites:

```powershell
Set-Location "c:\Users\Shaya\Downloads\MIRO-tested-partial-fixes\MIRO-main"

# 1. Root compilation build
npm run build

# 2. Complete backend & frontend unit/reliability tests
npm test

# 3. Live E2E lifecycle & H3 proximity test
npm --prefix backend test -- tests/live_lifecycle.test.ts

# 4. Full integration suite with live PostgreSQL & Redis
$env:MIRO_TEST_DATABASE_URL = "postgresql://postgres:postgrespassword@localhost:5433/miro_test_db?schema=public"
$env:MIRO_TEST_REDIS_URL = "redis://localhost:6380/1"
npm --prefix backend test -- --runInBand

# 5. Live OSRM geospatial test
npm --prefix frontend run test

# 6. Headless Edge CDP browser E2E test
npm --prefix frontend run test:browser
```

---

## 6. Accessing the User Interfaces

### Demo Accounts Seeded in Database

| Role | Name | Email | Password |
|---|---|---|---|
| **Rider** | Demo Rider | `rider@demo.com` | `password123` |
| **Real Driver (D1)** | Real Driver (D1) | `driver1@demo.com` | `password123` |
| **Simulated (D2)** | Simulated Driver D2 | `driver2@demo.com` | `password123` |
| **Simulated (D3-D8)** | Simulated Drivers D3..D8 | `driver3@demo.com` .. `driver8@demo.com` | `password123` |

### URLs:
- **Laptop Rider Interface:** `https://localhost:5173`
- **Mobile Driver (D1) Interface:** `https://<YOUR-LAN-IP>:5173` (e.g. `https://192.168.1.12:5173`)
- **Fleet Diagnostics Dashboard:** `https://localhost:5173/dashboard`
- **Backend Health Check:** `http://localhost:3000/health`

