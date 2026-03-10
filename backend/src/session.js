import { getDb } from './db.js';

/**
 * Session helpers for per-user auth. req.session.userId is set after OAuth (user id = email).
 * If the session cookie is not present, checks Authorization: Bearer <token> against auth_tokens (fallback when cookies don't stick).
 */
export async function getSessionUserId(req) {
  if (req.session?.userId) return req.session.userId;
  const authHeader = req.headers?.authorization;
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      try {
        const db = getDb();
        const row = await db.get('SELECT user_id FROM auth_tokens WHERE token = ? AND expires_at > NOW()', token);
        if (row) return row.user_id;
      } catch (_) {}
    }
  }
  return null;
}

/**
 * Returns the current user's id or null. Use for routes that need the logged-in user. Async because it may look up Bearer token.
 */
export async function requireSessionUserId(req, res) {
  const userId = await getSessionUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Not signed in. Sign in with Google first.' });
    return null;
  }
  return userId;
}
