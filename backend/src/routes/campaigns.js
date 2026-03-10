import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db.js';
import { decrypt } from '../crypto.js';
import { getAccessToken, sendEmail } from '../gmail.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import * as storage from '../storage.js';
import { requireSessionUserId } from '../session.js';

const router = Router();
const UPLOADS_DIR = process.env.UPLOADS_DIR || join(process.cwd(), 'data', 'uploads');
const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024; // 25 MB Gmail limit

/**
 * POST /campaigns/send-test
 * Send a single test email. Body: { accessToken, to, subject, body }
 * Used by extension with token from chrome.identity.getAuthToken().
 */
router.post('/send-test', async (req, res) => {
  try {
    const { accessToken, to, subject, body } = req.body || {};
    if (!to || !subject) {
      return res.status(400).json({ error: 'to and subject required' });
    }
    if (!accessToken || typeof accessToken !== 'string') {
      return res.status(401).json({ error: 'Missing OAuth token. In the extension, sign in with Google first (click the extension icon and try "Send test email" again). If it keeps failing, set the Chrome app OAuth client ID in manifest.json and reload the extension.' });
    }
    const messageId = await sendEmail(accessToken, {
      to,
      subject: subject || '(No subject)',
      body: body || '',
    });
    res.json({ success: true, messageId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /campaigns/send-test-linked
 * Send a test email using the linked Gmail account (no token from client). Body: { to }
 * Used by the web app where Chrome identity is not available.
 */
router.post('/send-test-linked', async (req, res) => {
  try {
    const userId = await requireSessionUserId(req, res);
    if (!userId) return;
    const { to } = req.body || {};
    if (!to || !String(to).trim()) {
      return res.status(400).json({ error: 'to (email address) required' });
    }
    const db = getDb();
    const user = await db.get(
      'SELECT encrypted_refresh_token FROM users WHERE id = ? AND encrypted_refresh_token IS NOT NULL AND encrypted_refresh_token != ?',
      userId,
      ''
    );
    if (!user) {
      return res.status(400).json({ error: 'No linked Gmail account. Link Gmail in the app first.' });
    }
    const refreshToken = decrypt(user.encrypted_refresh_token);
    const accessToken = await getAccessToken(refreshToken);
    if (!accessToken) {
      return res.status(401).json({ error: 'Could not get access token. Try linking Gmail again.' });
    }
    const messageId = await sendEmail(accessToken, {
      to: String(to).trim(),
      subject: 'Test from Gmail Campaign Sender',
      body: 'This is a test email.',
    });
    res.json({ success: true, messageId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /campaigns/schedule
 * Body: { sendAt, timezone, subject_template, body_template, csv_rows, attachment_storage_key? }
 * Uses the signed-in user's session to associate the job.
 */
router.post('/schedule', async (req, res) => {
  try {
    const { sendAt, timezone, subject_template, body_template, csv_rows, attachment_storage_key } = req.body;
    if (!sendAt || !subject_template || !body_template || !Array.isArray(csv_rows) || csv_rows.length === 0) {
      return res.status(400).json({ error: 'sendAt, subject_template, body_template, and non-empty csv_rows required' });
    }
    const first = csv_rows[0];
    if (!first || typeof first !== 'object' || !('email' in first)) {
      return res.status(400).json({ error: 'Each csv row must have an "email" field' });
    }

    const sessionUserId = await requireSessionUserId(req, res);
    if (!sessionUserId) return;

    const db = getDb();
    const user = await db.get('SELECT id FROM users WHERE id = ?', sessionUserId);
    if (!user) {
      return res.status(400).json({ error: 'No linked Gmail account. Sign in with Google first.' });
    }

    const id = uuidv4();
    await db.run(
      `INSERT INTO scheduled_jobs (id, user_id, send_at, timezone, subject_template, body_template, csv_rows, attachment_storage_key, status)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, 'pending')`,
      id,
      user.id,
      sendAt,
      timezone || 'UTC',
      subject_template,
      body_template,
      JSON.stringify(csv_rows),
      attachment_storage_key || null
    );

    res.status(201).json({ id, status: 'pending' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /campaigns/upload
 * Body: { filename: string, content: string (base64) }. Returns { attachment_storage_key } for use in /schedule.
 * Uses Supabase Storage when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set; otherwise local UPLOADS_DIR.
 */
router.post('/upload', async (req, res) => {
  try {
    const { filename: name, content: base64 } = req.body || {};
    if (!base64) return res.status(400).json({ error: 'body.filename and body.content (base64) required' });
    const content = Buffer.from(base64, 'base64');
    if (content.length > MAX_ATTACHMENT_SIZE) {
      return res.status(400).json({ error: 'File too large (max 25MB)' });
    }
    const filename = (name || 'attachment').replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${uuidv4()}_${filename}`;
    if (storage.hasStorage()) {
      await storage.uploadAttachment(key, content);
    } else {
      await mkdir(UPLOADS_DIR, { recursive: true });
      await writeFile(join(UPLOADS_DIR, key), content);
    }
    res.json({ attachment_storage_key: key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /campaigns/scheduled
 * Returns list of pending (scheduled, not yet sent) campaigns.
 */
router.get('/scheduled', async (req, res) => {
  try {
    const userId = await requireSessionUserId(req, res);
    if (!userId) return;
    const db = getDb();
    const jobs = await db.all(
      `SELECT id, send_at, timezone, subject_template, status, created_at, csv_rows
       FROM scheduled_jobs WHERE status = 'pending' AND user_id = ? ORDER BY send_at ASC LIMIT 100`,
      userId
    );
    const withCounts = jobs.map((job) => {
      const rows = typeof job.csv_rows === 'string' ? JSON.parse(job.csv_rows) : (job.csv_rows || []);
      return {
        id: job.id,
        send_at: job.send_at,
        timezone: job.timezone,
        subject_template: job.subject_template,
        status: job.status,
        created_at: job.created_at,
        recipient_count: rows.length,
      };
    });
    res.json({ campaigns: withCounts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /campaigns/scheduled/:id
 * Cancel a pending scheduled campaign (sets status to 'cancelled' so it no longer appears in scheduled list).
 */
router.delete('/scheduled/:id', async (req, res) => {
  try {
    const userId = await requireSessionUserId(req, res);
    if (!userId) return;
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Campaign id required' });
    const db = getDb();
    const job = await db.get('SELECT id, status FROM scheduled_jobs WHERE id = ? AND user_id = ?', id, userId);
    if (!job) return res.status(404).json({ error: 'Campaign not found' });
    if (job.status !== 'pending') return res.status(400).json({ error: 'Only pending campaigns can be cancelled' });
    await db.run("UPDATE scheduled_jobs SET status = 'cancelled' WHERE id = ?", id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /campaigns/send-now
 * Same body as /schedule but sends immediately (creates job with send_at = now, then runs processDueJobs).
 */
router.post('/send-now', async (req, res) => {
  try {
    const sessionUserId = await requireSessionUserId(req, res);
    if (!sessionUserId) return;
    const { timezone, subject_template, body_template, csv_rows, attachment_storage_key } = req.body || {};
    if (!subject_template || !body_template || !Array.isArray(csv_rows) || csv_rows.length === 0) {
      return res.status(400).json({ error: 'subject_template, body_template, and non-empty csv_rows required' });
    }
    const first = csv_rows[0];
    if (!first || typeof first !== 'object' || !('email' in first)) {
      return res.status(400).json({ error: 'Each csv row must have an "email" field' });
    }

    const db = getDb();
    const user = await db.get('SELECT id FROM users WHERE id = ?', sessionUserId);
    if (!user) {
      return res.status(400).json({ error: 'No linked Gmail account. Sign in with Google first.' });
    }

    const sendAt = new Date().toISOString();
    const id = uuidv4();
    await db.run(
      `INSERT INTO scheduled_jobs (id, user_id, send_at, timezone, subject_template, body_template, csv_rows, attachment_storage_key, status)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, 'pending')`,
      id,
      user.id,
      sendAt,
      timezone || 'UTC',
      subject_template,
      body_template,
      JSON.stringify(csv_rows),
      attachment_storage_key || null
    );

    await processDueJobs();

    res.status(201).json({ id, status: 'sent' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /campaigns/sent
 * Returns list of sent campaigns for dashboard.
 */
router.get('/sent', async (req, res) => {
  try {
    const userId = await requireSessionUserId(req, res);
    if (!userId) return;
    const db = getDb();
    const jobs = await db.all(
      `SELECT id, send_at, timezone, subject_template, status, created_at
       FROM scheduled_jobs WHERE user_id = ? AND status IN ('sent', 'failed') ORDER BY created_at DESC LIMIT 100`,
      userId
    );

    const withCounts = await Promise.all(
      jobs.map(async (job) => {
        const logs = await db.all('SELECT recipient_email, gmail_message_id, sent_at, error FROM sent_log WHERE job_id = ?', job.id);
        const sent = logs.filter((l) => !l.error).length;
        const failed = logs.filter((l) => l.error).length;
        return {
          id: job.id,
          send_at: job.send_at,
          timezone: job.timezone,
          subject_template: job.subject_template,
          status: job.status,
          created_at: job.created_at,
          recipient_count: logs.length,
          sent_count: sent,
          failed_count: failed,
          recipients: logs,
        };
      })
    );

    res.json({ campaigns: withCounts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

export async function processDueJobs() {
  const db = getDb();
  const now = new Date().toISOString();
  const due = await db.all(
    "SELECT * FROM scheduled_jobs WHERE status = 'pending' AND send_at <= ?",
    now
  );

  for (const job of due) {
    const user = await db.get('SELECT encrypted_refresh_token FROM users WHERE id = ?', job.user_id);
    if (!user) {
      await db.run("UPDATE scheduled_jobs SET status = 'failed' WHERE id = ?", job.id);
      continue;
    }

    let accessToken;
    try {
      const refreshToken = user.encrypted_refresh_token ? decrypt(user.encrypted_refresh_token) : null;
      if (!refreshToken) throw new Error('No stored refresh token. Complete "Link Gmail for scheduled sends" in the extension.');
      accessToken = await getAccessToken(refreshToken);
      if (!accessToken) throw new Error('Failed to get access token from refresh token.');
    } catch (err) {
      await db.run("UPDATE scheduled_jobs SET status = 'failed' WHERE id = ?", job.id);
      const rows = typeof job.csv_rows === 'string' ? JSON.parse(job.csv_rows) : job.csv_rows;
      for (const row of rows) {
        const email = row.email || row.Email;
        if (email) {
          await db.run(
            'INSERT INTO sent_log (job_id, recipient_email, error) VALUES (?, ?, ?)',
            job.id,
            email,
            err.message
          );
        }
      }
      continue;
    }

    const rows = typeof job.csv_rows === 'string' ? JSON.parse(job.csv_rows) : job.csv_rows;
    let attachment = null;
    if (job.attachment_storage_key) {
      try {
        const content = storage.hasStorage()
          ? await storage.downloadAttachment(job.attachment_storage_key)
          : await readFile(join(UPLOADS_DIR, job.attachment_storage_key));
        const name = job.attachment_storage_key.replace(/^[^_]+_/, '');
        attachment = { filename: name, content, mimeType: 'application/octet-stream' };
      } catch (e) {
        // log and continue without attachment
      }
    }

    for (const row of rows) {
      const to = row.email || row.Email;
      if (!to) continue;
      const subject = replacePlaceholders(job.subject_template, row);
      const body = replacePlaceholders(job.body_template, row, { htmlEscape: true });
      try {
        const messageId = await sendEmail(accessToken, { to, subject, body, attachment });
        await db.run(
          'INSERT INTO sent_log (job_id, recipient_email, gmail_message_id, sent_at) VALUES (?, ?, ?, NOW())',
          job.id,
          to,
          messageId
        );
      } catch (err) {
        await db.run(
          'INSERT INTO sent_log (job_id, recipient_email, error) VALUES (?, ?, ?)',
          job.id,
          to,
          err.message
        );
      }
    }

    await db.run("UPDATE scheduled_jobs SET status = 'sent' WHERE id = ?", job.id);
  }
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function replacePlaceholders(template, row, options = {}) {
  if (typeof template !== 'string') return '';
  const htmlEscape = options.htmlEscape === true;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = row[key];
    const raw = val != null ? String(val) : '';
    return htmlEscape ? escapeHtml(raw) : raw;
  });
}
