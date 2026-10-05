import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('3000').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().default('postgresql://postgres:postgrespassword@localhost:5432/uber_db?schema=public'),
  REDIS_URL: z.string().default('redis://localhost:6380'),
  JWT_SECRET: z.string().default('super_secret_jwt_key_for_uber_mvp_2026'),
  H3_RESOLUTION: z.string().default('8').transform((val) => parseInt(val, 10)),
  MAX_CANDIDATE_DRIVERS: z.string().default('8').transform((val) => parseInt(val, 10)),
  SIMULATOR_NUM_DRIVERS: z.string().default('7').transform((val) => parseInt(val, 10)),
});

export const env = envSchema.parse(process.env);
