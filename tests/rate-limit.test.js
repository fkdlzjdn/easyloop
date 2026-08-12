const { createRateLimiterStore } = require('../server/rate-limit');

describe('rate limiter response', () => {
  test('returns a Korean message and Retry-After after the limit', () => {
    const store = createRateLimiterStore({
      cleanupInterval: 200,
      staleMultiplier: 2
    });
    const limiter = store.createRateLimiter({ windowMs: 60000, max: 1 });
    const req = { ip: '127.0.0.1', baseUrl: '/api/auth', path: '/login' };
    const next = jest.fn();
    const res = {
      set: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnValue('limited')
    };

    expect(limiter(req, res, next)).toBeUndefined();
    expect(limiter(req, res, next)).toBe('limited');
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.set).toHaveBeenCalledWith('Retry-After', '60');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: expect.stringContaining('요청이 너무 많습니다'),
      retryAfterSeconds: 60
    }));
  });
});
