import { RequestHandler } from 'express';

// Process-local protection. Deploy a shared ingress limiter for multiple replicas.
export function rateLimit(limit: number, windowMs = 60_000): RequestHandler {
  const entries = new Map<string, { count: number; until: number }>();
  return (req, res, next) => {
    const now = Date.now();
    for (const [key, value] of entries) if (value.until <= now) entries.delete(key);
    const key = req.ip || 'unknown';
    let value = entries.get(key);
    if (!value) { value = { count: 0, until: now + windowMs }; entries.set(key, value); }
    if (++value.count > limit || entries.size > 10000) {
      res.setHeader('Retry-After', Math.ceil((value.until - now) / 1000));
      res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again shortly.' } });
      return;
    }
    next();
  };
}
