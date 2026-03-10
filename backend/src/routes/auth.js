import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db.js';
import { getAuthUrl, getRedirectUri, exchangeCodeForTokens } from '../gmail.js';
import { encrypt } from '../crypto.js';
import { getSessionUserId } from '../session.js';

const router = Router();

function escapeHtmlAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * GET /auth/me
 * Returns the currently signed-in user's linked Gmail (from session). Each device has its own session.
 */
router.get('/auth/me', async (req, res) => {
  try {
    const userId = getSessionUserId(req);
    if (!userId) {
      return res.json({ linked: false, email: null, id: null });
    }
    const db = getDb();
    const user = await db.get(
      'SELECT id, email FROM users WHERE id = ? AND encrypted_refresh_token IS NOT NULL AND encrypted_refresh_token != ? LIMIT 1',
      userId,
      ''
    );
    if (!user) {
      return res.json({ linked: false, email: null, id: null });
    }
    res.json({ linked: true, email: user.email, id: user.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /auth/url
 * Query: success_redirect (optional) - URL to redirect after OAuth. Should be your web app's linked page (e.g. https://your-app.vercel.app/linked.html).
 * If success_redirect is an extension URL (chrome-extension://), it is ignored and OAUTH_SUCCESS_REDIRECT is used instead so sign-in always lands on the web app.
 */
router.get('/auth/url', async (req, res) => {
  const state = uuidv4();
  let successRedirect = req.query.success_redirect || process.env.OAUTH_SUCCESS_REDIRECT;
  if (successRedirect && String(successRedirect).startsWith('chrome-extension://')) {
    successRedirect = process.env.OAUTH_SUCCESS_REDIRECT || null;
  }
  const db = getDb();
  if (successRedirect) {
    await db.run(
      'INSERT INTO oauth_states (state, success_redirect) VALUES (?, ?) ON CONFLICT (state) DO UPDATE SET success_redirect = EXCLUDED.success_redirect',
      state,
      successRedirect
    );
  } else {
    await db.run('INSERT INTO oauth_states (state) VALUES (?)', state);
  }
  const url = getAuthUrl(state);
  console.log('[OAuth] auth URL generated, redirect_uri:', getRedirectUri(), 'success_redirect:', successRedirect || '(env/default)');
  res.json({ url });
});

/**
 * GET /oauth/callback
 * Google redirects here with ?code=...&state=...
 * Exchange code for tokens, store user + encrypted refresh token, redirect to extension.
 */
router.get('/oauth/callback', async (req, res) => {
  const code = req.query.code;
  const state = req.query.state;
  console.log('[OAuth callback]', { hasCode: !!code, hasState: !!state, queryKeys: Object.keys(req.query || {}) });
  const db = getDb();
  const row = state ? await db.get('SELECT success_redirect FROM oauth_states WHERE state = ?', state) : null;
  let redirectBase = (row && row.success_redirect) || process.env.OAUTH_SUCCESS_REDIRECT || 'http://localhost:3000/success.html';
  if (!redirectBase || redirectBase.includes('your_extension_id') || redirectBase.startsWith('chrome-extension://')) {
    redirectBase = process.env.OAUTH_SUCCESS_REDIRECT || 'http://localhost:3000/success.html';
  }
  if (!state) console.log('[OAuth callback] no state from Google, using OAUTH_SUCCESS_REDIRECT:', redirectBase);

  const redirectError = (msg) => {
    console.error('[OAuth callback]', msg);
    const q = '?error=link_failed&message=' + encodeURIComponent(msg);
    return res.redirect(redirectBase + q);
  };

  if (!code) {
    return redirectError('Missing authorization code from Google.');
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret || clientSecret.length < 20) {
    return redirectError('Backend .env: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (Web application client from Google Cloud, not the Chrome app). Restart the backend.');
  }
  if (state && row) {
    await db.run('DELETE FROM oauth_states WHERE state = ?', state);
  }

  try {
    const result = await exchangeCodeForTokens(code);
    const { refreshToken, email } = result;
    if (!refreshToken || !email) {
      return redirectError('Google did not return a refresh token. Try revoking app access at myaccount.google.com/permissions and link again.');
    }

    const encrypted = encrypt(refreshToken);
    await db.run(
      `INSERT INTO users (id, email, encrypted_refresh_token) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET encrypted_refresh_token = EXCLUDED.encrypted_refresh_token`,
      email,
      email,
      encrypted
    );

    req.session.userId = email;
    let claimToken = null;
    try {
      claimToken = uuidv4();
      await db.run('INSERT INTO session_claims (token, user_id) VALUES (?, ?)', claimToken, email);
    } catch (_) {
      claimToken = null;
    }
    req.session.save((err) => {
      if (err) {
        console.error('[OAuth callback] session save error:', err);
        return redirectError('Session save failed. Try again.');
      }
      const targetUrl = redirectBase + (claimToken ? '?linked=1&claim=' + encodeURIComponent(claimToken) : '?linked=1');
      console.log('[OAuth callback] success, session set for', email, claimToken ? '(with claim token)' : '', 'redirecting to app');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).end(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sign-in successful</title></head><body><p>Sign-in successful. Redirecting…</p><p><a href="${escapeHtmlAttr(targetUrl)}">Continue to app</a> if you are not redirected.</p><script>setTimeout(function(){ location.href=${JSON.stringify(targetUrl)}; }, 800);</script></body></html>`
      );
    });
  } catch (err) {
    console.error('[OAuth callback] full error:', err.message, err.response?.data || '');
    const msg = err.message || String(err);
    if (msg.includes('ENCRYPTION_KEY')) {
      return redirectError('Set ENCRYPTION_KEY in .env to 64 hex characters (run: openssl rand -hex 32). Then restart the backend.');
    }
    if (msg.includes('missing required authentication credential') || msg.includes('invalid_client') || msg.includes('unauthorized')) {
      return redirectError('Google rejected the backend credentials. In .env use the WEB application client ID and secret (APIs & Services → Credentials → OAuth 2.0 Web client). Re-copy the Client secret from Google Cloud and restart the backend.');
    }
    if (msg.includes('redirect_uri_mismatch')) {
      return redirectError('Redirect URI mismatch. In Google Console, add exactly: ' + (process.env.OAUTH_REDIRECT_URI || 'http://localhost:3000/oauth/callback'));
    }
    return redirectError(msg);
  }
});

/**
 * GET /auth/claim?claim=TOKEN
 * One-time session claim: validate token (from post-OAuth redirect), set session, delete token.
 * Used when the session cookie does not stick on the OAuth callback redirect; the app calls this
 * with the claim token so the session is set in response to a request from the app origin.
 */
router.get('/auth/claim', async (req, res) => {
  const token = req.query.claim;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Missing claim token' });
  }
  try {
    const db = getDb();
    const row = await db.get('SELECT user_id FROM session_claims WHERE token = ?', token.trim());
    if (!row) {
      return res.status(400).json({ error: 'Invalid or expired claim token' });
    }
    await db.run('DELETE FROM session_claims WHERE token = ?', token.trim());
    req.session.userId = row.user_id;
    req.session.save((err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /auth/logout
 * Destroys the current session so this device is no longer signed in.
 */
router.post('/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true });
  });
});

export default router;
