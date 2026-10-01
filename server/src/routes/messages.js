import express from 'express';
import pool from '../db.js';
import { authRequired, isParticipant, isBlocked } from '../auth.js';
import { hydrateMessage, userName } from './conversations.js';

export default function messagesRouter(io, onlineUsers) {
  const r = express.Router();
  r.use(authRequired);

  async function loadAndSend(m) {
    const [rows] = await pool.query(
      `SELECT m.*, u.name AS sender_name, u.avatar_color AS sender_color
       FROM messages m LEFT JOIN users u ON u.id=m.sender_id WHERE m.id=?`, [m.id]);
    const full = hydrateMessage(rows[0], m.sender_id, [], [], rows[0].sender_name, rows[0].sender_color);
    io.to(`conv:${m.conversation_id}`).emit('message:new', full);
    // update last message in chat lists
    const [members] = await pool.query(
      'SELECT user_id FROM participants WHERE conversation_id=?', [m.conversation_id]);
    for (const mem of members) {
      io.to(`user:${mem.user_id}`).emit('conversation:update', { conversation_id: m.conversation_id });
    }
    return full;
  }

  r.post('/', async (req, res) => {
    const uid = req.user.id;
    const convId = +req.body?.conversation_id;
    if (!convId || !(await isParticipant(convId, uid))) {
      return res.status(403).json({ error: 'Not a participant' });
    }
    // block check: any non-self participant blocking?
    const [others] = await pool.query(
      'SELECT user_id FROM participants WHERE conversation_id=? AND user_id<>?', [convId, uid]);
    for (const o of others) {
      if (await isBlocked(o.user_id, uid)) {
        return res.status(403).json({ error: 'Message not delivered' });
      }
    }
    let type = String(req.body?.type || 'text');
    if (!['text', 'image', 'file', 'audio', 'poll'].includes(type)) type = 'text';
    const body = String(req.body?.body || '').slice(0, 8000);
    if (type === 'text' && !body.trim()) return res.status(400).json({ error: 'Message is empty' });
    let meta = null;
    if (type === 'poll') {
      const options = (req.body?.options || []).map(o => String(o).trim().slice(0, 120)).filter(Boolean).slice(0, 6);
      if (!body.trim() || options.length < 2) return res.status(400).json({ error: 'Poll needs a question and 2+ options' });
      meta = { options };
    }
    if ((type === 'image' || type === 'file' || type === 'audio') && !req.body?.media_path) {
      return res.status(400).json({ error: 'Missing media' });
    }
    const replyTo = req.body?.reply_to_id ? +req.body.reply_to_id : null;
    if (replyTo) {
      const [rt] = await pool.query('SELECT conversation_id FROM messages WHERE id=?', [replyTo]);
      if (!rt[0] || rt[0].conversation_id !== convId) return res.status(400).json({ error: 'Invalid reply target' });
    }
    const [ins] = await pool.query(
      `INSERT INTO messages (conversation_id, sender_id, type, body, meta, media_path, media_name, media_size, reply_to_id, forwarded)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [convId, uid, type, body,
       meta ? JSON.stringify(meta) : null,
       req.body?.media_path || null,
       req.body?.media_name ? String(req.body.media_name).slice(0, 200) : null,
       +req.body?.media_size || 0,
       replyTo, req.body?.forwarded ? 1 : 0]
    );
    // sender has read their own message
    await pool.query(
      `UPDATE participants SET last_read_message_id=GREATEST(last_read_message_id,?) WHERE conversation_id=? AND user_id=?`,
      [ins.insertId, convId, uid]);
    // receipts: delivered for online members
    for (const o of others) {
      await pool.query('INSERT IGNORE INTO message_receipts (message_id, user_id, delivered_at) VALUES (?,?,?)',
        [ins.insertId, o.user_id, onlineUsers.has(o.user_id) ? new Date() : null]);
    }
    const full = await loadAndSend({ id: ins.insertId, conversation_id: convId, sender_id: uid });
    if (replyTo) {
      const [rt] = await pool.query(
        `SELECT m.*, u.name AS sender_name FROM messages m LEFT JOIN users u ON u.id=m.sender_id WHERE m.id=?`, [replyTo]);
      if (rt[0]) full.reply_to = hydrateMessage(rt[0], uid, [], [], rt[0].sender_name);
    }
    res.json(full);
  });

  r.post('/:id/reaction', async (req, res) => {
    const uid = req.user.id;
    const mid = +req.params.id;
    const emoji = String(req.body?.emoji || '').slice(0, 16);
    const [mrows] = await pool.query('SELECT * FROM messages WHERE id=?', [mid]);
    const m = mrows[0];
    if (!m || !(await isParticipant(m.conversation_id, uid))) return res.status(403).json({ error: 'Not allowed' });
    const [existing] = await pool.query(
      'SELECT * FROM reactions WHERE message_id=? AND user_id=?', [mid, uid]);
    if (existing[0] && existing[0].emoji === emoji) {
      await pool.query('DELETE FROM reactions WHERE message_id=? AND user_id=?', [mid, uid]);
    } else if (existing[0]) {
      await pool.query('UPDATE reactions SET emoji=? WHERE message_id=? AND user_id=?', [emoji, mid, uid]);
    } else {
      await pool.query('INSERT INTO reactions (message_id, user_id, emoji) VALUES (?,?,?)', [mid, uid, emoji]);
    }
    const [all] = await pool.query('SELECT user_id, emoji FROM reactions WHERE message_id=?', [mid]);
    const map = all.reduce((acc, x) => { (acc[x.emoji] = acc[x.emoji] || []).push(x.user_id); return acc; }, {});
    io.to(`conv:${m.conversation_id}`).emit('reaction:update', { id: mid, reactions: map });
    res.json({ reactions: map });
  });

  r.post('/:id/poll-vote', async (req, res) => {
    const uid = req.user.id;
    const mid = +req.params.id;
    const opt = +req.body?.option_index;
    const [mrows] = await pool.query('SELECT * FROM messages WHERE id=?', [mid]);
    const m = mrows[0];
    if (!m || m.type !== 'poll' || !(await isParticipant(m.conversation_id, uid))) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    const options = (m.meta || {}).options || [];
    if (!(opt >= 0 && opt < options.length)) return res.status(400).json({ error: 'Invalid option' });
    await pool.query('INSERT INTO poll_votes (message_id, user_id, option_index) VALUES (?,?,?) ON DUPLICATE KEY UPDATE option_index=?',
      [mid, uid, opt, opt]);
    const [all] = await pool.query('SELECT user_id, option_index FROM poll_votes WHERE message_id=?', [mid]);
    const map = all.reduce((acc, x) => { (acc[x.option_index] = acc[x.option_index] || []).push(x.user_id); return acc; }, {});
    io.to(`conv:${m.conversation_id}`).emit('poll:update', { id: mid, votes: map });
    res.json({ votes: map });
  });

  r.patch('/:id', async (req, res) => {
    const uid = req.user.id;
    const mid = +req.params.id;
    const [mrows] = await pool.query('SELECT * FROM messages WHERE id=?', [mid]);
    const m = mrows[0];
    if (!m) return res.status(404).json({ error: 'Not found' });
    if (m.sender_id !== uid) return res.status(403).json({ error: 'You can only edit your own messages' });
    if (m.type !== 'text' || m.deleted_at) return res.status(400).json({ error: 'Cannot edit this message' });
    const body = String(req.body?.body || '').slice(0, 8000);
    if (!body.trim()) return res.status(400).json({ error: 'Message is empty' });
    await pool.query('UPDATE messages SET body=?, edited=1 WHERE id=?', [body, mid]);
    io.to(`conv:${m.conversation_id}`).emit('message:update', { id: mid, body, edited: true });
    res.json({ ok: true });
  });

  r.delete('/:id', async (req, res) => {
    const uid = req.user.id;
    const mid = +req.params.id;
    const [mrows] = await pool.query('SELECT * FROM messages WHERE id=?', [mid]);
    const m = mrows[0];
    if (!m) return res.status(404).json({ error: 'Not found' });
    if (m.sender_id !== uid) return res.status(403).json({ error: 'You can only delete your own messages' });
    await pool.query('UPDATE messages SET deleted_at=NOW() WHERE id=?', [mid]);
    io.to(`conv:${m.conversation_id}`).emit('message:update', {
      id: mid, type: 'deleted', body: 'This message was deleted'
    });
    res.json({ ok: true });
  });

  r.post('/:id/forward', async (req, res) => {
    const uid = req.user.id;
    const mid = +req.params.id;
    const targetIds = [...new Set((req.body?.to || []).map(Number))];
    const [mrows] = await pool.query('SELECT * FROM messages WHERE id=?', [mid]);
    const m = mrows[0];
    if (!m || !(await isParticipant(m.conversation_id, uid))) return res.status(403).json({ error: 'Not allowed' });
    for (const t of targetIds) {
      if (!(await isParticipant(t, uid))) continue;
      await pool.query(
        `INSERT INTO messages (conversation_id, sender_id, type, body, meta, media_path, media_name, media_size, forwarded)
         VALUES (?,?,?,?,?,?,?,?,1)`,
        [t, uid, m.type, m.body, m.meta ? JSON.stringify(m.meta) : null,
         m.media_path, m.media_name, m.media_size]
      );
      io.to(`conv:${t}`).emit('message:new', hydrateMessage(
        (await pool.query('SELECT * FROM messages WHERE conversation_id=? ORDER BY id DESC LIMIT 1', [t]))[0][0], uid));
      io.to(`user:${uid}`).emit('conversation:update', { conversation_id: t });
    }
    res.json({ ok: true });
  });

  return r;
}
