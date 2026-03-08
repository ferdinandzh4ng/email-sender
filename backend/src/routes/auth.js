import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db.js';
import { getAuthUrl, getRedirectUri, exchangeCodeForTokens } from '../gmail.js';
import { encrypt } from '../crypto.js';

const router = Router();

/**
 * GET /auth/me
 * Returns the currently linked Gmail user (first user with a refresh token). Used by extension to show "Linked as email" and persist linked state.
 */
router.get('/auth/me', async (req, res) => {
  try {
    const db = getDb();
    const user = await db.get(
      'SELECT id, email FROM users WHERE encrypted_refresh_token IS NOT NULL AND encrypted_refresh_token != ? LIMIT 1',
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
 * Query: success_redirect (optional) - URL to redirect after OAuth (e.g. chrome-extension://id/success.html)
 * Returns OAuth URL for extension to open in a new tab.
 */
router.get('/auth/url', async (req, res) => {
  const state = uuidv4();
  const successRedirect = req.query.success_redirect || process.env.OAUTH_SUCCESS_REDIRECT;
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
  const baseUrl = getAuthUrl();
  const url = `${baseUrl}&state=${encodeURIComponent(state)}`;
  console.log('[OAuth] auth URL generated, redirect_uri sent to Google:', getRedirectUri());
  res.json({ url });
});

/**
 * GET /oauth/callback
 * Google redirects here with ?code=...&state=...
 * Exchange code for tokens, store user + encrypted refresh token, redirect to extension.
 */
router.get('/oauth/callback', async (req, res) => {
  const { code, state } = req.query;
  console.log('[OAuth callback]', { hasCode: !!code, hasState: !!state, queryKeys: Object.keys(req.query || {}), url: req.url?.slice(0, 120) });
  const db = getDb();
  const row = state ? await db.get('SELECT success_redirect FROM oauth_states WHERE state = ?', state) : null;
  let redirectBase = (row && row.success_redirect) || process.env.OAUTH_SUCCESS_REDIRECT || 'http://localhost:3000/success.html';
  if (redirectBase.includes('your_extension_id')) redirectBase = 'http://localhost:3000/success.html';

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

    console.log('[OAuth callback] success, redirecting to', redirectBase);
    return res.redirect(redirectBase + '?linked=1');
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

export default router;
