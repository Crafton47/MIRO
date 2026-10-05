import http from 'http';
import app from './app.js';
import { env } from './config/env.js';
import { socketServer } from './websocket/socket.server.js';
import { logger } from './utils/logger.js';

const httpServer = http.createServer(app);

// Attach Socket.IO real-time server
socketServer.init(httpServer);

const PORT = env.PORT;

httpServer.listen(PORT, () => {
  logger.info(`==================================================`);
  logger.info(`🚀 Uber MVP Backend Server listening on port ${PORT}`);
  logger.info(`📡 WebSocket Server active on ws://localhost:${PORT}`);
  logger.info(`==================================================`);
});

export { httpServer };
