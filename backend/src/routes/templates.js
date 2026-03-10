import { Router } from 'express';
import { getDb } from '../db.js';
import { requireSessionUserId } from '../session.js';

const router = Router();

/**
 * GET /templates
 * Returns the signed-in user's templates (id, name, subject, body, updated_at).
 */
router.get('/', async (req, res) => {
  try {
    const userId = requireSessionUserId(req, res);
    if (!userId) return;
    const db = getDb();
    try {
      const rows = await db.all(
        'SELECT id, name, subject, body, updated_at FROM templates WHERE user_id = ? ORDER BY id',
        userId
      );
      if (rows && rows.length) {
        return res.json(rows.map((r) => ({ id: r.id, name: r.name || 'Default', subject: r.subject || '', body: r.body || '', updated_at: r.updated_at })));
      }
    } catch (e) {
      if (e.message && e.message.includes('user_id')) {
        return res.status(500).json({ error: 'Templates table needs user_id. Run: ALTER TABLE templates ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id);' });
      }
      if (!e.message || !e.message.includes('name')) throw e;
    }
    return res.json([]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /templates/:id
 * Delete a template by id (only if it belongs to the signed-in user).
 */
router.delete('/:id', async (req, res) => {
  try {
    const userId = requireSessionUserId(req, res);
    if (!userId) return;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid template id' });
    const db = getDb();
    const row = await db.get('SELECT id FROM templates WHERE id = ? AND user_id = ?', id, userId);
    if (!row) return res.status(404).json({ error: 'Template not found' });
    await db.run('DELETE FROM templates WHERE id = ? AND user_id = ?', id, userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /templates/:id
 * Returns one template by id (only if it belongs to the signed-in user).
 */
router.get('/:id', async (req, res) => {
  try {
    const userId = requireSessionUserId(req, res);
    if (!userId) return;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid template id' });
    const db = getDb();
    const row = await db.get('SELECT id, subject, body, updated_at FROM templates WHERE id = ? AND user_id = ?', id, userId);
    if (!row) return res.status(404).json({ error: 'Template not found' });
    let name = 'Default';
    try {
      const withName = await db.get('SELECT name FROM templates WHERE id = ? AND user_id = ?', id, userId);
      if (withName && withName.name) name = withName.name;
    } catch (_) {}
    res.json({ id: row.id, name, subject: row.subject || '', body: row.body || '', updated_at: row.updated_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /templates
 * Body: { id?, name?, subject, body }. If id provided, update (only if owner); else create new template for signed-in user.
 */
router.post('/', async (req, res) => {
  try {
    const userId = requireSessionUserId(req, res);
    if (!userId) return;
    const { id, name, subject, body } = req.body || {};
    const db = getDb();
    const sub = subject ?? '';
    const bod = body ?? '';
    const nam = (name ?? 'Default').trim() || 'Default';

    if (id != null && id !== '') {
      const numId = parseInt(id, 10);
      if (isNaN(numId)) return res.status(400).json({ error: 'Invalid template id' });
      const existing = await db.get('SELECT id FROM templates WHERE id = ? AND user_id = ?', numId, userId);
      if (!existing) return res.status(404).json({ error: 'Template not found' });
      try {
        await db.run(
          'UPDATE templates SET subject = ?, body = ?, updated_at = NOW() WHERE id = ? AND user_id = ?',
          sub,
          bod,
          numId,
          userId
        );
        try {
          await db.run('UPDATE templates SET name = ? WHERE id = ? AND user_id = ?', nam, numId, userId);
        } catch (_) {}
        return res.json({ success: true, id: numId });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    try {
      await db.run(
        'INSERT INTO templates (user_id, name, subject, body, updated_at) VALUES (?, ?, ?, ?, NOW())',
        userId,
        nam,
        sub,
        bod
      );
      const row = await db.get('SELECT id FROM templates WHERE user_id = ? ORDER BY id DESC LIMIT 1', userId);
      return res.status(201).json({ success: true, id: row?.id ?? 1 });
    } catch (insertErr) {
      if (insertErr.message && insertErr.message.includes('column') && insertErr.message.includes('user_id')) {
        return res.status(500).json({ error: 'Templates table needs user_id. Run: ALTER TABLE templates ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id);' });
      }
      if (insertErr.message && insertErr.message.includes('column') && insertErr.message.includes('name')) {
        await db.run(
          'INSERT INTO templates (user_id, subject, body, updated_at) VALUES (?, ?, ?, NOW())',
          userId,
          sub,
          bod
        );
        const row = await db.get('SELECT id FROM templates WHERE user_id = ? ORDER BY id DESC LIMIT 1', userId);
        return res.status(201).json({ success: true, id: row?.id ?? 1 });
      }
      throw insertErr;
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
