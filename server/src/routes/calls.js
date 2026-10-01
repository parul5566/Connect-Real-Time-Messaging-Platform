import express from 'express';
import pool from '../db.js';
import { authRequired, isBlocked } from '../auth.js';

export default function callsRouter(io, onlineUsers) {
  const r = express.Router();
  r.use(authRequired);

  r.get('/', async (req, res) => {
    const uid = req.user.id;
    const [rows] = await pool.query(
      `SELECT c.*,
        caller.name AS caller_name, callee.name AS callee_name,
        caller.avatar_color AS caller_color, callee.avatar_color AS callee_color
       FROM calls c
       JOIN users caller ON caller.id=c.caller_id
       JOIN users callee ON callee.id=c.callee_id
       WHERE c.caller_id=? OR c.callee_id=?
       ORDER BY c.started_at DESC LIMIT 100`, [uid, uid]);
    res.json(rows.map(c => ({
      id: c.id, type: c.type, status: c.status,
      direction: c.caller_id === uid ? 'outgoing' : 'incoming',
      other: c.caller_id === uid
        ? { id: c.callee_id, name: c.callee_name, avatar_color: c.callee_color }
        : { id: c.caller_id, name: c.caller_name, avatar_color: c.caller_color },
      started_at: c.started_at, ended_at: c.ended_at, duration_secs: c.duration_secs
    })));
  });

  // create a ringing call (callee accepts via socket)
  r.post('/', async (req, res) => {
    const uid = req.user.id;
    const calleeId = +req.body?.calleeId;
    const type = req.body?.type === 'video' ? 'video' : 'voice';
    if (!calleeId || calleeId === uid) return res.status(400).json({ error: 'Pick a contact' });
    if (await isBlocked(calleeId, uid)) return res.status(403).json({ error: 'Call cannot be placed' });
    const [ins] = await pool.query(
      "INSERT INTO calls (caller_id, callee_id, type) VALUES (?,?,?)", [uid, calleeId, type]);
    const payload = { callId: ins.insertId, type, callerId: uid, callerName: req.user.name };
    if (onlineUsers.has(calleeId)) {
      io.to(`user:${calleeId}`).emit('call:ring', payload);
    }
    res.json({ callId: ins.insertId, calleeOnline: onlineUsers.has(calleeId) });
  });

  r.post('/:id/outcome', async (req, res) => {
    const uid = req.user.id;
    const id = +req.params.id;
    const status = String(req.body?.status || '');
    if (!['completed', 'declined', 'missed', 'failed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const [rows] = await pool.query('SELECT * FROM calls WHERE id=?', [id]);
    const c = rows[0];
    if (!c || (c.caller_id !== uid && c.callee_id !== uid)) return res.status(403).json({ error: 'Not allowed' });
    const duration = status === 'completed' ? +req.body?.duration_secs || 0 : 0;
    await pool.query('UPDATE calls SET status=?, ended_at=NOW(), duration_secs=? WHERE id=?',
      [status, duration, id]);
    res.json({ ok: true });
  });

  return r;
}
