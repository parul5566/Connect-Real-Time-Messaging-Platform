import express from 'express';
import pool from '../db.js';
import { authRequired, isBlocked } from '../auth.js';

export default function channelsRouter(io) {
  const r = express.Router();
  r.use(authRequired);

  r.get('/', async (req, res) => {
    const uid = req.user.id;
    const [rows] = await pool.query(
      `SELECT c.*, (SELECT COUNT(*) FROM channel_follows f WHERE f.channel_id=c.id) AS followers,
        EXISTS(SELECT 1 FROM channel_follows f WHERE f.channel_id=c.id AND f.user_id=?) AS following
       FROM channels c ORDER BY c.id`, [uid]);
    res.json(rows.map(c => ({ ...c, following: !!c.following, is_owner: c.created_by === uid })));
  });

  r.post('/', async (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 100);
    const description = String(req.body?.description || '').trim().slice(0, 200);
    if (!name) return res.status(400).json({ error: 'Enter a channel name' });
    const [ins] = await pool.query(
      'INSERT INTO channels (name, description, created_by) VALUES (?,?,?)',
      [name, description, req.user.id]);
    await pool.query('INSERT INTO channel_follows (channel_id, user_id) VALUES (?,?)', [ins.insertId, req.user.id]);
    io.emit('channels:update');
    res.json({ id: ins.insertId });
  });

  r.post('/:id/follow', async (req, res) => {
    await pool.query('INSERT IGNORE INTO channel_follows (channel_id, user_id) VALUES (?,?)',
      [+req.params.id, req.user.id]);
    io.emit('channels:update');
    res.json({ ok: true });
  });
  r.post('/:id/unfollow', async (req, res) => {
    await pool.query('DELETE FROM channel_follows WHERE channel_id=? AND user_id=?',
      [+req.params.id, req.user.id]);
    io.emit('channels:update');
    res.json({ ok: true });
  });

  r.get('/:id/posts', async (req, res) => {
    const uid = req.user.id;
    const [follow] = await pool.query('SELECT 1 FROM channel_follows WHERE channel_id=? AND user_id=?',
      [+req.params.id, uid]);
    if (!follow[0]) return res.status(403).json({ error: 'Follow this channel to read posts' });
    const [posts] = await pool.query(
      `SELECT p.*, u.name AS author_name FROM channel_posts p JOIN users u ON u.id=p.author_id
       WHERE p.channel_id=? ORDER BY p.id DESC LIMIT 100`, [+req.params.id]);
    res.json(posts);
  });

  r.post('/:id/posts', async (req, res) => {
    const uid = req.user.id;
    const body = String(req.body?.body || '').trim().slice(0, 4000);
    if (!body) return res.status(400).json({ error: 'Post is empty' });
    const [ch] = await pool.query('SELECT * FROM channels WHERE id=?', [+req.params.id]);
    if (!ch[0]) return res.status(404).json({ error: 'Channel not found' });
    if (ch[0].created_by !== uid) return res.status(403).json({ error: 'Only the channel owner can post' });
    const [ins] = await pool.query(
      'INSERT INTO channel_posts (channel_id, author_id, body) VALUES (?,?,?)',
      [ch[0].id, uid, body]);
    io.emit('channel:post', { channel_id: ch[0].id, id: ins.insertId });
    res.json({ id: ins.insertId });
  });

  return r;
}
