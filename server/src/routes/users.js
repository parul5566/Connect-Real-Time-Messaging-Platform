import express from 'express';
import { authRequired } from '../auth.js';

export default function usersRouter(io) {
  const r = express.Router();
  r.use(authRequired);

  // current user
  r.get('/me', (req, res) => res.json(safeUser(req.user)));

  r.put('/me', async (req, res) => {
    const name = req.body?.name !== undefined ? String(req.body.name).trim().slice(0, 80) : undefined;
    const about = req.body?.about !== undefined ? String(req.body.about).trim().slice(0, 160) : undefined;
    const avatarColor = req.body?.avatar_color !== undefined ? String(req.body.avatar_color).slice(0, 16) : undefined;
    const avatarUrl = req.body?.avatar_url !== undefined ? String(req.body.avatar_url).slice(0, 255) : undefined;
    const sets = [], vals = [];
    if (name) { sets.push('name=?'); vals.push(name); }
    if (about !== undefined) { sets.push('about=?'); vals.push(about); }
    if (avatarColor) { sets.push('avatar_color=?'); vals.push(avatarColor); }
    if (avatarUrl !== undefined) { sets.push('avatar_url=?'); vals.push(avatarUrl); }
    if (sets.length) {
      await pool.query(`UPDATE users SET ${sets.join(',')} WHERE id=?`, [...vals, req.user.id]);
    }
    const [rows] = await pool.query('SELECT * FROM users WHERE id=?', [req.user.id]);
    res.json(safeUser(rows[0]));
  });

  // settings (JSON blob)
  r.get('/me/settings', async (req, res) => {
    res.json(req.user.settings || {});
  });
  r.put('/me/settings', async (req, res) => {
    await pool.query('UPDATE users SET settings=? WHERE id=?',
      [JSON.stringify(req.body || {}), req.user.id]);
    res.json({ ok: true });
  });

  // user directory (excluding self & blocked visibility is client-side)
  r.get('/', async (req, res) => {
    const q = String(req.query.q || '').trim();
    let rows;
    if (q) {
      [rows] = await pool.query(
        'SELECT id, name, about, avatar_color, avatar_url FROM users WHERE deleted=0 AND id<>? AND name LIKE ? LIMIT 50',
        [req.user.id, `%${q}%`]
      );
    } else {
      [rows] = await pool.query(
        'SELECT id, name, about, avatar_color, avatar_url FROM users WHERE deleted=0 AND id<>? ORDER BY name LIMIT 50',
        [req.user.id]
      );
    }
    res.json(rows);
  });

  // blocked list management
  r.get('/me/blocked', async (req, res) => {
    const blocked = req.user.blocked_users || [];
    if (!blocked.length) return res.json([]);
    const [rows] = await pool.query(
      'SELECT id, name, avatar_color, avatar_url FROM users WHERE id IN (?)', [blocked]
    );
    res.json(rows);
  });
  r.post('/me/block/:userId', async (req, res) => {
    const uid = +req.params.userId;
    const blocked = new Set(req.user.blocked_users || []);
    blocked.add(uid); blocked.delete(req.user.id);
    await pool.query('UPDATE users SET blocked_users=? WHERE id=?',
      [JSON.stringify([...blocked]), req.user.id]);
    res.json({ ok: true });
  });
  r.post('/me/unblock/:userId', async (req, res) => {
    const uid = +req.params.userId;
    const blocked = (req.user.blocked_users || []).filter(id => id !== uid);
    await pool.query('UPDATE users SET blocked_users=? WHERE id=?',
      [JSON.stringify(blocked), req.user.id]);
    res.json({ ok: true });
  });

  return r;
}

import pool from '../db.js';

export function safeUser(u) {
  return {
    id: u.id, phone: u.phone, name: u.name, about: u.about,
    avatar_color: u.avatar_color, avatar_url: u.avatar_url,
    has_pin: !!u.two_step_pin_hash, settings: u.settings || {},
    blocked_users: u.blocked_users || []
  };
}
