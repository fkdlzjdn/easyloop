const express = require('express');
const crypto = require('crypto');
const {
  AUTH_TOKEN_TTL_MS,
  getAuthToken,
  isAuthTokenValid,
  setAuthCookie,
  clearAuthCookie
} = require('../auth');

function createAuthRouter({ authSessions, getSharedPassword, authRateLimiter }) {
  const router = express.Router();

  router.post('/login', authRateLimiter, (req, res) => {
    const { password, role } = req.body || {};

    if (!password) {
      return res.status(400).json({ success: false, message: 'Password required' });
    }

    const sharedPassword = getSharedPassword();
    if (sharedPassword && password !== sharedPassword) {
      return res.status(401).json({ success: false, message: 'Invalid password' });
    }

    const userRole = (role === 'engineer') ? 'engineer' : 'user';
    const token = crypto.randomBytes(24).toString('hex');
    authSessions.set(token, { createdAt: Date.now(), role: userRole });
    setAuthCookie(res, token, AUTH_TOKEN_TTL_MS);

    return res.json({ success: true, role: userRole });
  });

  router.post('/logout', (req, res) => {
    const token = getAuthToken(req);
    if (token) {
      authSessions.delete(token);
    }
    clearAuthCookie(res);
    return res.json({ success: true });
  });

  router.get('/status', (req, res) => {
    const token = getAuthToken(req);
    const valid = isAuthTokenValid(authSessions, token);
    const session = valid ? authSessions.get(token) : null;
    return res.json({
      authenticated: valid,
      role: session ? (session.role || 'user') : null
    });
  });

  return router;
}

module.exports = { createAuthRouter };
