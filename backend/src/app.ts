import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import authRoutes from './routes/auth.routes.js';
import driverRoutes from './routes/driver.routes.js';
import rideRoutes from './routes/ride.routes.js';
import simulatorRoutes from './routes/simulator.routes.js';
import { errorHandler } from './middleware/error.middleware.js';
import { getRedisClient } from './config/redis.js';
import { prisma } from './config/prisma.js';
import { socketServer } from './websocket/socket.server.js';
import { driverSimulatorService } from './services/simulator/simulator.service.js';

const app = express();

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Development-only system status check (no sensitive data exposed)
app.get('/api/v1/system/status', async (_req, res) => {
  let redisStatus = 'disconnected';
  try {
    const redis = getRedisClient();
    const pong = await Promise.race([
      redis.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 500)),
    ]);
    if (pong === 'PONG') redisStatus = 'connected';
  } catch {
    redisStatus = 'disconnected';
  }

  let postgresStatus = 'disconnected';
  try {
    await Promise.race([
      prisma.$queryRawUnsafe('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 500)),
    ]);
    postgresStatus = 'connected';
  } catch {
    postgresStatus = 'disconnected';
  }

  let socketStatus = 'disconnected';
  try {
    if (socketServer.getIO()) {
      socketStatus = 'running';
    }
  } catch {
    socketStatus = 'disconnected';
  }

  res.status(200).json({
    success: true,
    data: {
      backend: 'running',
      redis: redisStatus,
      postgres: postgresStatus,
      socket: socketStatus,
      simulator: driverSimulatorService.getStatus(),
    },
  });
});

// Development-only Dashboard static route
const baseDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
const candidates = [
  path.join(process.cwd(), 'public', 'dashboard'),
  path.join(process.cwd(), 'backend', 'public', 'dashboard'),
  path.join(baseDir, '..', 'public', 'dashboard'),
  path.join(baseDir, 'public', 'dashboard'),
];
const dashboardDir = candidates.find((dir) => fs.existsSync(dir)) || path.join(process.cwd(), 'public', 'dashboard');

app.use('/dashboard', express.static(dashboardDir));
app.get('/dashboard', (_req, res) => {
  const htmlPath = path.join(dashboardDir, 'index.html');
  if (fs.existsSync(htmlPath)) {
    res.sendFile(htmlPath);
  } else {
    res.status(404).send('Dashboard not found');
  }
});

// Versioned API Routes (/api/v1)
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/drivers', driverRoutes);
app.use('/api/v1/rides', rideRoutes);
app.use('/api/v1/simulator', simulatorRoutes);

// Centralized Error Middleware
app.use(errorHandler);

export default app;
