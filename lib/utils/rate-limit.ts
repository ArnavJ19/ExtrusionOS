/**
 * Simple sliding-window rate limiter for serverless environments.
 * Uses an in-memory Map with automatic TTL cleanup.
 *
 * NOTE: In a multi-instance deployment (Vercel serverless), each instance
 * maintains its own state. For stricter enforcement, integrate Upstash Redis.
 * This provides a reasonable first layer of defense.
 */

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const store = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 60 seconds to prevent memory leaks
let lastCleanup = Date.now();
function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
}

export type RateLimitConfig = {
  /** Maximum requests allowed in the window */
  limit: number;
  /** Window duration in seconds */
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

/**
 * Check if a request is within the rate limit.
 * @param identifier - Unique key (e.g., IP address or IP + path)
 * @param config - Rate limit configuration
 */
export function checkRateLimit(identifier: string, config: RateLimitConfig): RateLimitResult {
  cleanup();
  const now = Date.now();
  const entry = store.get(identifier);

  if (!entry || entry.resetAt <= now) {
    const resetAt = now + config.windowSeconds * 1000;
    store.set(identifier, { count: 1, resetAt });
    return { allowed: true, remaining: config.limit - 1, resetAt };
  }

  if (entry.count >= config.limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return { allowed: true, remaining: config.limit - entry.count, resetAt: entry.resetAt };
}
