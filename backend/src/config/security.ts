import { env } from './env.js';

export const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(s => s.trim());
export const corsOptions = { origin: allowedOrigins, methods: ['GET', 'POST', 'PATCH'], credentials: false };
export const demoEnabled = env.NODE_ENV !== 'production' && process.env.DEMO_MODE === 'true';
