/**
 * Create a shared rate limiter store with cleanup.
 * @param {{cleanupInterval: number, staleMultiplier: number}} config
 * @returns {{createRateLimiter: (limitConfig: {windowMs: number, max: number}) => Function}}
 */
function createRateLimiterStore(config) {
  const store = new Map();
  let requestCount = 0;

  function getRateLimitKey(req) {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const route = `${req.baseUrl || ''}${req.path || ''}`;
    return `${ip}:${route}`;
  }

  function cleanup(now, windowMs) {
    const staleAfterMs = windowMs * config.staleMultiplier;
    for (const [key, entry] of store.entries()) {
      if (!entry || !Array.isArray(entry.hits)) {
        store.delete(key);
        continue;
      }
      const filteredHits = entry.hits.filter(ts => now - ts <= entry.windowMs);
      entry.hits = filteredHits;
      if (filteredHits.length === 0 && now - entry.lastSeen > staleAfterMs) {
        store.delete(key);
      }
    }
  }

  function createRateLimiter(limitConfig) {
    const windowMs = limitConfig.windowMs;
    const max = limitConfig.max;

    return (req, res, next) => {
      const now = Date.now();
      const key = getRateLimitKey(req);
      const entry = store.get(key) || { hits: [], lastSeen: now, windowMs };

      entry.hits = entry.hits.filter(ts => now - ts <= windowMs);
      entry.hits.push(now);
      entry.lastSeen = now;
      entry.windowMs = windowMs;
      store.set(key, entry);

      requestCount += 1;
      if (requestCount % config.cleanupInterval === 0) {
        cleanup(now, windowMs);
      }

      if (entry.hits.length > max) {
        return res.status(429).json({ success: false, message: 'Rate limit exceeded' });
      }

      return next();
    };
  }

  return { createRateLimiter };
}

module.exports = { createRateLimiterStore };
