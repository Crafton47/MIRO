import Redis from 'ioredis';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

// In-Memory fallback implementation for unit tests or when Redis container is offline
class MemoryRedis {
  private kv = new Map<string, string>();
  private sets = new Map<string, Set<string>>();
  private hashes = new Map<string, Map<string, string>>();

  async get(key: string): Promise<string | null> {
    return this.kv.get(key) || null;
  }

  async set(key: string, value: string, _mode?: string, _duration?: number): Promise<'OK'> {
    this.kv.set(key, value);
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const k of keys) {
      if (this.kv.delete(k)) count++;
      if (this.sets.delete(k)) count++;
      if (this.hashes.delete(k)) count++;
    }
    return count;
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    if (!this.sets.has(key)) {
      this.sets.set(key, new Set());
    }
    const set = this.sets.get(key)!;
    let added = 0;
    for (const m of members) {
      if (!set.has(m)) {
        set.add(m);
        added++;
      }
    }
    return added;
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const m of members) {
      if (set.delete(m)) removed++;
    }
    return removed;
  }

  async smembers(key: string): Promise<string[]> {
    const set = this.sets.get(key);
    return set ? Array.from(set) : [];
  }

  async hset(key: string, field: string | Record<string, string>, value?: string): Promise<number> {
    if (!this.hashes.has(key)) {
      this.hashes.set(key, new Map());
    }
    const map = this.hashes.get(key)!;
    if (typeof field === 'object') {
      for (const [k, v] of Object.entries(field)) {
        map.set(k, String(v));
      }
      return Object.keys(field).length;
    } else {
      map.set(field, String(value ?? ''));
      return 1;
    }
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const map = this.hashes.get(key);
    if (!map) return {};
    const res: Record<string, string> = {};
    for (const [k, v] of map.entries()) {
      res[k] = v;
    }
    return res;
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    const allKeys = [
      ...Array.from(this.kv.keys()),
      ...Array.from(this.sets.keys()),
      ...Array.from(this.hashes.keys()),
    ];
    return Array.from(new Set(allKeys.filter((k) => regex.test(k))));
  }

  async flushall(): Promise<'OK'> {
    this.kv.clear();
    this.sets.clear();
    this.hashes.clear();
    return 'OK';
  }
}

let redisClient: any;
let isMock = false;

if (process.env.NODE_ENV === 'test') {
  redisClient = new MemoryRedis();
  isMock = true;
} else {
  try {
    const client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      retryStrategy(times) {
        if (times > 2) {
          logger.warn('Redis connection failed. Switching to in-memory fallback store.');
          isMock = true;
          redisClient = new MemoryRedis();
          return null;
        }
        return Math.min(times * 100, 500);
      },
      enableOfflineQueue: true,
    });

    client.on('error', (err) => {
      if (!isMock) {
        logger.warn(`Redis Client Error (${err.message}). Using MemoryRedis store.`);
      }
    });

    client.on('connect', () => {
      logger.info(`✅ Connected to Redis at ${env.REDIS_URL}`);
    });

    redisClient = client;
  } catch (e) {
    logger.warn('Failed to initialize Redis client. Falling back to MemoryRedis store.');
    redisClient = new MemoryRedis();
    isMock = true;
  }
}

export function getRedisClient(): any {
  if (isMock || !redisClient) {
    if (!redisClient) redisClient = new MemoryRedis();
    return redisClient;
  }
  return redisClient;
}

export { MemoryRedis };
