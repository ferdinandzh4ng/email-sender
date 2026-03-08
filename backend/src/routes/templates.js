import { Router } from 'express';
import { getDb } from '../db.js';

const router = Router();

/**
 * GET /templates
 * Returns list of templates (id, name, subject, body, updated_at). Supports multi-template schema (name column); falls back to single template.
 */
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    try {
      const rows = await db.all('SELECT id, name, subject, body, updated_at FROM templates ORDER BY id');
      if (rows && rows.length) {
        return res.json(rows.map((r) => ({ id: r.id, name: r.name || 'Default', subject: r.subject || '', body: r.body || '', updated_at: r.updated_at })));
      }
    } catch (e) {
      if (!e.message || !e.message.includes('name')) throw e;
    }
    const row = await db.get('SELECT id, subject, body, updated_at FROM templates WHERE id = 1');
    if (!row) return res.json([]);
    res.json([{ id: row.id, name: 'Default', subject: row.subject || '', body: row.body || '', updated_at: row.updated_at }]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /templates/:id
 * Returns one template by id.
 */
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid template id' });
    const db = getDb();
    const row = await db.get('SELECT id, subject, body, updated_at FROM templates WHERE id = ?', id);
    if (!row) return res.status(404).json({ error: 'Template not found' });
    let name = 'Default';
    try {
      const withName = await db.get('SELECT name FROM templates WHERE id = ?', id);
      if (withName && withName.name) name = withName.name;
    } catch (_) {}
    res.json({ id: row.id, name, subject: row.subject || '', body: row.body || '', updated_at: row.updated_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /templates
 * Body: { id?, name?, subject, body }. If id provided, update; else create new template.
 */
router.post('/', async (req, res) => {
  try {
    const { id, name, subject, body } = req.body || {};
    const db = getDb();
    const sub = subject ?? '';
    const bod = body ?? '';
    const nam = (name ?? 'Default').trim() || 'Default';

    if (id != null && id !== '') {
      const numId = parseInt(id, 10);
      if (isNaN(numId)) return res.status(400).json({ error: 'Invalid template id' });
      try {
        await db.run(
          'UPDATE templates SET subject = ?, body = ?, updated_at = NOW() WHERE id = ?',
          sub,
          bod,
          numId
        );
        try {
          await db.run('UPDATE templates SET name = ? WHERE id = ?', nam, numId);
        } catch (_) {}
        return res.json({ success: true, id: numId });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    try {
      await db.run(
        'INSERT INTO templates (name, subject, body, updated_at) VALUES (?, ?, ?, NOW())',
        nam,
        sub,
        bod
      );
      const row = await db.get('SELECT id FROM templates ORDER BY id DESC LIMIT 1');
      return res.status(201).json({ success: true, id: row?.id ?? 1 });
    } catch (insertErr) {
      if (insertErr.message && insertErr.message.includes('column') && insertErr.message.includes('name')) {
        await db.run(
          'INSERT INTO templates (subject, body, updated_at) VALUES (?, ?, NOW())',
          sub,
          bod
        );
        const row = await db.get('SELECT id FROM templates ORDER BY id DESC LIMIT 1');
        return res.status(201).json({ success: true, id: row?.id ?? 1 });
      }
      throw insertErr;
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
