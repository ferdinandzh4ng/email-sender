import { google } from 'googleapis';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/userinfo.email',
];

/**
 * Create OAuth2 client for token exchange (code -> refresh_token).
 */
export function createOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.OAUTH_REDIRECT_URI || `${process.env.BACKEND_URL || 'http://localhost:3000'}/oauth/callback`;
  if (!clientId || !clientSecret) throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET required');
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getRedirectUri() {
  return process.env.OAUTH_REDIRECT_URI || `${process.env.BACKEND_URL || 'http://localhost:3000'}/oauth/callback`;
}

/**
 * Get auth URL for extension to open in launchWebAuthFlow.
 */
export function getAuthUrl() {
  const oauth2 = createOAuth2Client();
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state: undefined, // caller adds state
  });
}

/**
 * Exchange authorization code for tokens. Returns { refresh_token, email }.
 */
export async function exchangeCodeForTokens(code) {
  const oauth2 = createOAuth2Client();
  const redirectUri = getRedirectUri();
  console.log('[OAuth] exchanging code, redirect_uri:', redirectUri);
  let tokens;
  try {
    const result = await oauth2.getToken({ code: String(code).trim(), redirect_uri: redirectUri });
    tokens = result.tokens;
  } catch (err) {
    const body = err.response?.data;
    const detail = body ? JSON.stringify(body) : err.message;
    console.error('[OAuth] getToken failed:', detail);
    throw new Error(body?.error_description || body?.error || err.message);
  }
  if (!tokens.refresh_token) throw new Error('No refresh_token in response; user may have already granted access.');
  oauth2.setCredentials(tokens);
  let email = 'unknown';
  try {
    const oauth2Client = google.oauth2({ version: 'v2', auth: oauth2 });
    const { data } = await oauth2Client.userinfo.get();
    email = data.email || email;
  } catch (err) {
    console.error('[OAuth] userinfo.get failed:', err.response?.data || err.message);
  }
  return { refreshToken: tokens.refresh_token, email };
}

/**
 * Get access token from refresh token (plain text; caller decrypts if stored encrypted).
 */
export async function getAccessToken(refreshTokenPlain) {
  const oauth2 = createOAuth2Client();
  oauth2.setCredentials({ refresh_token: refreshTokenPlain });
  const { credentials } = await oauth2.refreshAccessToken();
  return credentials.access_token;
}

/**
 * Build MIME message and send via Gmail API.
 * Body is sent as HTML so embedded links (<a href="...">) work.
 * @param {string} accessToken
 * @param {{ to: string, subject: string, body: string, attachment?: { filename: string, content: Buffer, mimeType: string } }}
 */
export async function sendEmail(accessToken, { to, subject, body, attachment }) {
  if (!accessToken || typeof accessToken !== 'string' || accessToken.length < 10) {
    throw new Error('Missing or invalid OAuth access token. For "Send test email": sign in with Google in the extension (Chrome app OAuth client must be set in manifest.json). For scheduled sends: complete "Link Gmail for scheduled sends" and try again.');
  }
  const htmlBody = body.trim().startsWith('<!') ? body : `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${body.replace(/\n/g, '<br>\n')}</body></html>`;
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    '',
    htmlBody,
  ];

  if (attachment && attachment.content && attachment.content.length) {
    const mimeType = attachment.mimeType || 'application/octet-stream';
    const filename = attachment.filename || 'attachment';
    const b64 = attachment.content.toString('base64');
    lines.push(
      `--${boundary}`,
      `Content-Type: ${mimeType}; name="${filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${filename}"`,
      '',
      b64,
      ''
    );
  }

  lines.push(`--${boundary}--`);
  const raw = Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail API error: ${res.status} ${err}`);
  }
  const data = await res.json();
  return data.id;
}
