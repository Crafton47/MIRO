import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import os from 'os';
import authRoutes from './routes/auth.routes.js';
import driverRoutes from './routes/driver.routes.js';
import rideRoutes from './routes/ride.routes.js';
import simulatorRoutes from './routes/simulator.routes.js';
import { errorHandler } from './middleware/error.middleware.js';
import { getRedisClient, getRedisMode } from './config/redis.js';
import { prisma } from './config/prisma.js';
import { socketServer } from './websocket/socket.server.js';
import { driverSimulatorService } from './services/simulator/simulator.service.js';
import { corsOptions, demoEnabled } from './config/security.js';
import { rateLimit } from './middleware/rateLimit.middleware.js';

const app = express();

app.disable('x-powered-by');
app.use(cors(corsOptions));
app.use(express.json({ limit: '16kb' }));
app.use('/api', rateLimit(600));
app.use('/api/v1/auth', rateLimit(20));
app.use(['/api/v1/system', '/dashboard', '/api/v1/simulator'], (_req, res, next) => {
  if (!demoEnabled) { res.sendStatus(404); return; }
  next();
});

export function getNetworkInfo() {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  const primaryLanIp = process.env.MIRO_LAN_IP || addresses.find(ip => ip.startsWith('192.168.')) || addresses[0] || 'localhost';
  return {
    lanIps: addresses,
    primaryLanIp,
    backendPort: 3000,
    frontendPort: 5173,
    mobileDriverUrl: `${process.env.MIRO_HTTPS === 'false' ? 'http' : 'https'}://${primaryLanIp}:5173`,
    backendUrl: `http://${primaryLanIp}:3000`,
  };
}

// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Network information for laptop-mobile connectivity
app.get('/api/v1/system/network-info', (_req, res) => {
  res.status(200).json({
    success: true,
    data: getNetworkInfo(),
  });
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
    if (pong === 'PONG') redisStatus = getRedisMode() === 'memory' ? 'memory-demo' : 'connected';
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
