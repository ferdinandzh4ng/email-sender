/**
 * Session helpers for per-user auth. req.session.userId is set after OAuth (user id = email).
 */

export function getSessionUserId(req) {
  return req.session?.userId ?? null;
}

/**
 * Returns the current user's id or null. Use for routes that need the logged-in user.
 */
export function requireSessionUserId(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Not signed in. Sign in with Google first.' });
    return null;
  }
  return userId;
}
