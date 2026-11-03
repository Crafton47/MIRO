import Redis from 'ioredis';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

// In-Memory fallback implementation for unit tests or when Redis container is offline
class MemoryRedis {
  private expirations = new Map<string, number>();
  private kv = new Map<string, string>();
  private sets = new Map<string, Set<string>>();
  private hashes = new Map<string, Map<string, string>>();

  // Synchronous mutation mirrors a Redis script: no await may interleave packets.
  atomicLocationUpdate(driverId: string, fields: Record<string, string>): Record<string, string> {
    const key = `driver:location:${driverId}`;
    this.expireIfNeeded(key);
    const previous = this.hashes.get(key) || new Map<string, string>();
    if (Number(fields.updatedAt) < Number(previous.get('updatedAt') || 0)) return Object.fromEntries(previous);
    const oldCell = previous.get('h3Index');
    const status = fields.status || previous.get('status') || 'ONLINE';
    const next = new Map([...previous, ...Object.entries(fields), ['status', status]]);
    this.hashes.set(key, next);
    if (oldCell && oldCell !== fields.h3Index) this.sets.get(`h3:${oldCell}:drivers`)?.delete(driverId);
    for (const setKey of [`h3:${fields.h3Index}:drivers`, 'drivers:online']) {
      if (status === 'ONLINE') {
        if (!this.sets.has(setKey)) this.sets.set(setKey, new Set());
        this.sets.get(setKey)!.add(driverId);
      } else this.sets.get(setKey)?.delete(driverId);
    }
    return Object.fromEntries(next);
  }

  private expireIfNeeded(key: string) {
    if ((this.expirations.get(key) ?? Infinity) <= Date.now()) {
      this.kv.delete(key); this.hashes.delete(key); this.sets.delete(key); this.expirations.delete(key);
    }
  }

  async get(key: string): Promise<string | null> {
    this.expireIfNeeded(key);
    return this.kv.get(key) || null;
  }

  async set(key: string, value: string, _mode?: string, _duration?: number): Promise<'OK'> {
    this.expirations.delete(key);
    if (_mode === 'EX' && _duration !== undefined) this.expirations.set(key, Date.now() + _duration * 1000);
    this.kv.set(key, value);
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const k of keys) {
      this.expireIfNeeded(k); this.expirations.delete(k);
      if (this.kv.delete(k)) count++;
      if (this.sets.delete(k)) count++;
      if (this.hashes.delete(k)) count++;
    }
    return count;
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    this.expireIfNeeded(key);
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
    this.expireIfNeeded(key);
    const set = this.sets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const m of members) {
      if (set.delete(m)) removed++;
    }
    return removed;
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.expireIfNeeded(key);
    if (!this.kv.has(key) && !this.hashes.has(key) && !this.sets.has(key)) return 0;
    this.expirations.set(key, Date.now() + seconds * 1000);
    return 1;
  }

  async smembers(key: string): Promise<string[]> {
    this.expireIfNeeded(key);
    const set = this.sets.get(key);
    return set ? Array.from(set) : [];
  }

  async hset(key: string, field: string | Record<string, string>, value?: string): Promise<number> {
    this.expireIfNeeded(key);
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
    this.expireIfNeeded(key);
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

  async ping(): Promise<string> {
    return 'PONG';
  }

  async flushall(): Promise<'OK'> {
    this.expirations.clear();
    this.kv.clear();
    this.sets.clear();
    this.hashes.clear();
    return 'OK';
  }
}

let redisClient: any;
let isMock = false;
let lastRedisWarnTime = 0;
const REDIS_WARN_THROTTLE_MS = 60_000;

if (process.env.NODE_ENV === 'test') {
  redisClient = new MemoryRedis();
  isMock = true;
} else {
  try {
    const client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      retryStrategy(times) {
        // In demo mode without real Redis, switch after first attempts
        if (env.NODE_ENV !== 'production' && process.env.DEMO_MODE === 'true' && times > 2) {
          if (!isMock) {
            logger.warn('Redis unavailable in DEMO_MODE; switching to in-memory fallback store');
            isMock = true;
            redisClient = new MemoryRedis();
          }
          return null;
        }
        // Bounded backoff between 1s and 10s to prevent aggressive CPU/port thrashing
        return Math.min(Math.max(times * 1000, 1000), 10000);
      },
      enableOfflineQueue: false,
    });

    client.on('error', (err: any) => {
      if (env.NODE_ENV !== 'production' && process.env.DEMO_MODE === 'true' && !isMock) {
        logger.warn('Redis connection failed; using development memory store');
        isMock = true;
        redisClient = new MemoryRedis();
        try {
          client.disconnect();
        } catch {}
        return;
      }

      // Throttle repeated reconnect warning messages to at most once per 60s
      const now = Date.now();
      if (now - lastRedisWarnTime > REDIS_WARN_THROTTLE_MS) {
        lastRedisWarnTime = now;
        const reason = err?.code === 'ECONNREFUSED' ? 'connection refused (is Redis running?)' : err?.message || 'offline';
        logger.warn(`Redis unavailable at ${env.REDIS_URL} (${reason}); reconnecting in background...`);
      }
    });

    client.on('connect', () => {
      lastRedisWarnTime = 0;
      if (isMock) {
        logger.info(`Reconnected to Redis at ${env.REDIS_URL}; restored live Redis store`);
        isMock = false;
        redisClient = client;
      } else {
        logger.info(`Connected to Redis at ${env.REDIS_URL}`);
      }
    });

    redisClient = client;
  } catch (e) {
    if (env.NODE_ENV === 'production' || process.env.DEMO_MODE !== 'true') throw e;
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

export function getRedisMode(): 'memory' | 'redis' { return isMock ? 'memory' : 'redis'; }

export { MemoryRedis };
