const AUTH_COOKIE_NAME = 'amr_auth';
const AUTH_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;

  cookieHeader.split(';').forEach((part) => {
    const [rawKey, ...rest] = part.trim().split('=');
    if (!rawKey) return;
    cookies[rawKey] = decodeURIComponent(rest.join('=') || '');
  });

  return cookies;
}

function getAuthToken(req) {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }

  const cookies = parseCookies(req.headers.cookie || '');
  return cookies[AUTH_COOKIE_NAME] || '';
}

function isAuthTokenValid(authSessions, token) {
  if (!token) return false;
  const session = authSessions.get(token);
  if (!session) return false;
  if (Date.now() - session.createdAt > AUTH_TOKEN_TTL_MS) {
    authSessions.delete(token);
    return false;
  }
  return true;
}

function setAuthCookie(res, token, maxAgeMs = AUTH_TOKEN_TTL_MS) {
  const maxAge = Math.floor(maxAgeMs / 1000);
  res.setHeader('Set-Cookie', `${AUTH_COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`);
}

function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', `${AUTH_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

/**
 * Create middleware that enforces auth on /api routes.
 * @param {Map<string, {createdAt: number}>} authSessions
 * @returns {(req: any, res: any, next: Function) => any}
 */
function createAuthMiddleware(authSessions) {
  return (req, res, next) => {
    if (req.path.startsWith('/auth/')) {
      return next();
    }

    const token = getAuthToken(req);
    if (!isAuthTokenValid(authSessions, token)) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    // Attach role to request for downstream use
    const session = authSessions.get(token);
    req.userRole = session ? (session.role || 'user') : 'user';

    return next();
  };
}

module.exports = {
  AUTH_COOKIE_NAME,
  AUTH_TOKEN_TTL_MS,
  parseCookies,
  getAuthToken,
  isAuthTokenValid,
  setAuthCookie,
  clearAuthCookie,
  createAuthMiddleware
};
