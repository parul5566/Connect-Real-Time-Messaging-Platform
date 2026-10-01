import express from 'express';
import pool from '../db.js';
import { authRequired } from '../auth.js';

export default function aiRouter() {
  const r = express.Router();
  r.use(authRequired);

  // Sources CRUD
  r.get('/sources', async (req, res) => {
    const [rows] = await pool.query(
      'SELECT id, name, enabled, CHAR_LENGTH(text) AS chars, LEFT(text, 140) AS preview FROM ai_sources WHERE user_id=? ORDER BY id DESC',
      [req.user.id]);
    res.json(rows);
  });

  r.post('/sources', async (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 120);
    const text = String(req.body?.text || '').trim().slice(0, 50000);
    if (!name || !text) return res.status(400).json({ error: 'Title and text are required' });
    const [ins] = await pool.query(
      'INSERT INTO ai_sources (user_id, name, text) VALUES (?,?,?)', [req.user.id, name, text]);
    res.json({ id: ins.insertId });
  });

  r.patch('/sources/:id', async (req, res) => {
    await pool.query('UPDATE ai_sources SET enabled=? WHERE id=? AND user_id=?',
      [req.body?.enabled ? 1 : 0, +req.params.id, req.user.id]);
    res.json({ ok: true });
  });

  r.delete('/sources/:id', async (req, res) => {
    await pool.query('DELETE FROM ai_sources WHERE id=? AND user_id=?', [+req.params.id, req.user.id]);
    res.json({ ok: true });
  });

  r.get('/sources/:id', async (req, res) => {
    const [rows] = await pool.query('SELECT id, name, text, enabled FROM ai_sources WHERE id=? AND user_id=?',
      [+req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  });

  // Guardrails settings
  r.get('/history', async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT role, content, sources, created_at FROM ai_messages WHERE user_id=? ORDER BY id DESC LIMIT 50`, [req.user.id]);
      res.json(rows.reverse().map(r => ({ ...r, sources: r.sources ? JSON.parse(r.sources) : [] })));
    } catch { res.json([]); }
  });

  r.delete('/history', async (req, res) => {
    try { await pool.query('DELETE FROM ai_messages WHERE user_id=?', [req.user.id]); } catch {}
    res.status(204).end();
  });

  r.get('/guardrails', async (req, res) => {
    let [rows] = await pool.query('SELECT pii, injection, grounding FROM ai_guardrails WHERE user_id=?', [req.user.id]);
    if (!rows[0]) {
      await pool.query('INSERT IGNORE INTO ai_guardrails (user_id) VALUES (?)', [req.user.id]);
      rows = [{ pii: 1, injection: 1, grounding: 1 }];
    }
    res.json({ pii: !!rows[0].pii, injection: !!rows[0].injection, grounding: !!rows[0].grounding });
  });

  r.put('/guardrails', async (req, res) => {
    await pool.query('INSERT INTO ai_guardrails (user_id, pii, injection, grounding) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE pii=?, injection=?, grounding=?',
      [req.user.id, req.body?.pii ? 1 : 0, req.body?.injection ? 1 : 0, req.body?.grounding ? 1 : 0,
       req.body?.pii ? 1 : 0, req.body?.injection ? 1 : 0, req.body?.grounding ? 1 : 0]);
    res.json({ ok: true });
  });

  return r;
}
