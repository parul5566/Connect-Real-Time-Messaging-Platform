import express from 'express';
import pool from '../db.js';
import { authRequired } from '../auth.js';

export default function statusesRouter(io) {
  const r = express.Router();
  r.use(authRequired);

  r.get('/', async (req, res) => {
    const uid = req.user.id;
    const [mine] = await pool.query(
      `SELECT s.*, (SELECT COUNT(*) FROM status_views v WHERE v.status_id=s.id) AS view_count
       FROM statuses s WHERE s.user_id=? AND s.expires_at>NOW() ORDER BY s.id DESC`, [uid]);
    const [others] = await pool.query(
      `SELECT s.*, u.name, u.avatar_color, u.avatar_url,
        (SELECT COUNT(*) FROM status_views v WHERE v.status_id=s.id AND v.viewer_id=?) AS seen
       FROM statuses s JOIN users u ON u.id=s.user_id
       WHERE s.user_id<>? AND s.expires_at>NOW() AND u.deleted=0
       ORDER BY s.created_at DESC`, [uid, uid]);
    // group others by user
    const grouped = {};
    for (const s of others) {
      (grouped[s.user_id] = grouped[s.user_id] || { user_id: s.user_id, name: s.name, avatar_color: s.avatar_color, avatar_url: s.avatar_url, statuses: [] }).statuses.push(s);
    }
    res.json({ mine, others: Object.values(grouped) });
  });

  r.post('/', async (req, res) => {
    const body = String(req.body?.body || '').trim().slice(0, 700);
    const gradient = String(req.body?.bg_gradient || '').slice(0, 200);
    if (!body) return res.status(400).json({ error: 'Write something for your status' });
    const [ins] = await pool.query(
      'INSERT INTO statuses (user_id, body, bg_gradient, expires_at) VALUES (?,?,?, DATE_ADD(NOW(), INTERVAL 24 HOUR))',
      [req.user.id, body, gradient || 'linear-gradient(145deg,#276f60,#214845)']);
    broadcast(io);
    res.json({ id: ins.insertId });
  });

  r.delete('/:id', async (req, res) => {
    await pool.query('DELETE FROM statuses WHERE id=? AND user_id=?', [+req.params.id, req.user.id]);
    broadcast(io);
    res.json({ ok: true });
  });

  r.post('/:id/view', async (req, res) => {
    await pool.query('INSERT IGNORE INTO status_views (status_id, viewer_id) VALUES (?,?)',
      [+req.params.id, req.user.id]);
    res.json({ ok: true });
  });

  r.get('/:id/views', async (req, res) => {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.avatar_color, u.avatar_url, v.viewed_at
       FROM status_views v JOIN users u ON u.id=v.viewer_id
       WHERE v.status_id=? ORDER BY v.viewed_at DESC`, [+req.params.id]);
    res.json(rows);
  });

  return r;
}

async function broadcast(io) {
  io.emit('status:update');
}
