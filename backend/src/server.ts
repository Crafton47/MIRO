import http from 'http';
import app, { getNetworkInfo } from './app.js';
import { env } from './config/env.js';
import { socketServer } from './websocket/socket.server.js';
import { offerExpiryService } from './services/matching/offerExpiry.service.js';
import { logger } from './utils/logger.js';
import { prisma } from './config/prisma.js';
import { getRedisClient, getRedisMode } from './config/redis.js';

const httpServer = http.createServer(app);

// Attach Socket.IO real-time server
socketServer.init(httpServer);
offerExpiryService.start();
httpServer.on('close', () => offerExpiryService.stop());

const PORT = env.PORT;
const lanIp = getNetworkInfo().primaryLanIp;

async function checkStartupHealth() {
  const sanitizedDbUrl = env.DATABASE_URL.replace(/:[^:@]+@/, ':***@');
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    logger.info('🗄️  Database: PostgreSQL connected successfully via Prisma');
  } catch (err: any) {
    const isConnErr =
      err?.name === 'PrismaClientInitializationError' ||
      err?.message?.includes("Can't reach database server") ||
      err?.code === 'P1001';

    if (isConnErr) {
      logger.warn(`⚠️  Database: PostgreSQL is not reachable at ${sanitizedDbUrl}`);
      logger.warn('             Ensure PostgreSQL is running to enable persistent ride data and user accounts.');
    } else {
      logger.warn(`⚠️  Database: Connection error: ${err.message}`);
    }
  }

  try {
    const redis = getRedisClient();
    const pong = await Promise.race([
      redis.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500)),
    ]);
    if (pong === 'PONG') {
      const mode = getRedisMode();
      if (mode === 'memory') {
        logger.info('📦 Cache:    Running in development in-memory mode (MemoryRedis)');
      } else {
        logger.info(`📦 Cache:    Connected to Redis at ${env.REDIS_URL}`);
      }
    }
  } catch {
    logger.warn(`⚠️  Cache:    Redis is not reachable at ${env.REDIS_URL} (reconnecting in background)`);
  }
}

httpServer.listen(PORT, '0.0.0.0', () => {
  logger.info(`==================================================`);
  logger.info(`🚀 MIRO Backend Server listening on 0.0.0.0:${PORT}`);
  logger.info(`💻 Laptop Local:   http://localhost:${PORT}`);
  logger.info(`📱 Mobile LAN:     http://${lanIp}:${PORT}`);
  logger.info(`📡 WebSocket URL:  ws://${lanIp}:${PORT}`);
  logger.info(`==================================================`);
  checkStartupHealth().catch(() => {});
});

export { httpServer };
