import express from 'express';
import pool from '../db.js';
import { authRequired, isParticipant, isBlocked } from '../auth.js';

export default function conversationsRouter(io, onlineUsers) {
  const r = express.Router();
  r.use(authRequired);

  function convRow(c, meId) {
    return {
      id: c.id, type: c.type, name: c.name, about: c.about,
      avatar_color: c.avatar_color, created_by: c.created_by,
      created_at: c.created_at, disappearing_ttl: c.disappearing_ttl
    };
  }

  r.get('/', async (req, res) => {
    const uid = req.user.id;
    const [rows] = await pool.query(
      `SELECT c.*, p.favorite, p.archived, p.muted, p.last_read_message_id,
        (SELECT m.body FROM messages m WHERE m.conversation_id=c.id AND m.deleted_at IS NULL ORDER BY m.id DESC LIMIT 1) AS last_body,
        (SELECT m.type FROM messages m WHERE m.conversation_id=c.id AND m.deleted_at IS NULL ORDER BY m.id DESC LIMIT 1) AS last_type,
        (SELECT m.sender_id FROM messages m WHERE m.conversation_id=c.id AND m.deleted_at IS NULL ORDER BY m.id DESC LIMIT 1) AS last_sender,
        (SELECT m.created_at FROM messages m WHERE m.conversation_id=c.id AND m.deleted_at IS NULL ORDER BY m.id DESC LIMIT 1) AS last_at,
        (SELECT m.id FROM messages m WHERE m.conversation_id=c.id AND m.deleted_at IS NULL ORDER BY m.id DESC LIMIT 1) AS last_id,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id AND m.deleted_at IS NULL AND m.sender_id<>? AND m.id > p.last_read_message_id) AS unread
       FROM conversations c
       JOIN participants p ON p.conversation_id=c.id AND p.user_id=?
       ORDER BY last_at DESC, c.id DESC`,
      [uid, uid]
    );
    // attach other participants for direct chats
    const out = [];
    for (const c of rows) {
      const [members] = await pool.query(
        `SELECT u.id, u.name, u.about, u.avatar_color, u.avatar_url, p.role
         FROM participants p JOIN users u ON u.id=p.user_id
         WHERE p.conversation_id=? AND u.deleted=0`,
        [c.id]
      );
      const others = members.filter(m => m.id !== uid);
      const item = convRow(c, uid);
      item.favorite = !!c.favorite; item.archived = !!c.archived; item.muted = !!c.muted;
      item.unread = c.unread;
      item.members = members.map(m => ({ ...m, role: m.role }));
      if (c.type === 'direct') {
        const o = others[0];
        if (o) {
          item.display_name = o.name;
          item.avatar_color = o.avatar_color;
          item.avatar_url = o.avatar_url;
          item.other_id = o.id;
          item.other_about = o.about;
        }
      } else {
        item.display_name = c.name || 'Group';
      }
      item.last_preview = c.last_id
        ? (c.last_sender === uid ? 'You: ' : '') +
          (c.last_type === 'image' ? '📷 Photo' : c.last_type === 'audio' ? '🎤 Voice message' :
           c.last_type === 'file' ? `📄 ${c.last_body || 'Document'}` :
           c.last_type === 'poll' ? '📊 Poll' : (c.last_body || ''))
        : 'Start a conversation';
      item.last_at = c.last_at;
      out.push(item);
    }
    res.json(out);
  });

  r.post('/', async (req, res) => {
    const { type, userId, name, about, memberIds } = req.body || {};
    const uid = req.user.id;
    if (type === 'direct') {
      const other = +userId;
      if (!other || other === uid) return res.status(400).json({ error: 'Pick a contact' });
      if (await isBlocked(other, uid)) return res.status(403).json({ error: 'You cannot message this user' });
      const [found] = await pool.query(
        `SELECT c.id FROM conversations c
         JOIN participants p1 ON p1.conversation_id=c.id AND p1.user_id=?
         JOIN participants p2 ON p2.conversation_id=c.id AND p2.user_id=?
         WHERE c.type='direct' LIMIT 1`, [uid, other]);
      if (found[0]) return res.json({ id: found[0].id });
      const [ins] = await pool.query("INSERT INTO conversations (type, created_by) VALUES ('direct',?)", [uid]);
      await pool.query('INSERT INTO participants (conversation_id, user_id) VALUES (?,?),(?,?)',
        [ins.insertId, uid, ins.insertId, other]);
      return res.json({ id: ins.insertId });
    }
    if (type === 'group') {
      const gname = String(name || '').trim().slice(0, 100);
      if (!gname) return res.status(400).json({ error: 'Enter a group name' });
      const members = [...new Set((memberIds || []).map(Number).filter(id => id && id !== uid))].slice(0, 100);
      const [ins] = await pool.query(
        "INSERT INTO conversations (type, name, about, created_by) VALUES ('group',?,?,?)",
        [gname, String(about || '').trim().slice(0, 200), uid]
      );
      const convId = ins.insertId;
      await pool.query('INSERT INTO participants (conversation_id, user_id, role) VALUES (?,?,"admin")', [convId, uid]);
      for (const m of members) {
        await pool.query('INSERT IGNORE INTO participants (conversation_id, user_id) VALUES (?,?)', [convId, m]);
      }
      await addSystemMessage(convId, uid, `You created the group “${gname}”`);
      broadcastParticipants(io, convId);
      return res.json({ id: convId });
    }
    res.status(400).json({ error: 'Invalid conversation type' });
  });

  r.get('/:id/messages', async (req, res) => {
    const convId = +req.params.id;
    if (!(await isParticipant(convId, req.user.id))) return res.status(403).json({ error: 'Not a participant' });
    const before = +(req.query.before || 0);
    const limit = Math.min(+(req.query.limit || 50), 100);
    const [msgs] = await pool.query(
      `SELECT m.*, u.name AS sender_name, u.avatar_color AS sender_color FROM messages m
       LEFT JOIN users u ON u.id=m.sender_id
       WHERE m.conversation_id=? AND m.id<? ORDER BY m.id DESC LIMIT ?`,
      [convId, before || 999999999, limit]
    );
    // search filter (q)
    let list = msgs;
    if (req.query.q) {
      const q = String(req.query.q).toLowerCase();
      list = msgs.filter(m => (m.body || '').toLowerCase().includes(q));
    }
    const ids = msgs.map(m => m.id);
    let reactions = [], votes = [];
    if (ids.length) {
      [reactions] = await pool.query('SELECT message_id, user_id, emoji FROM reactions WHERE message_id IN (?)', [ids]);
      [votes] = await pool.query('SELECT message_id, user_id, option_index FROM poll_votes WHERE message_id IN (?)', [ids]);
    }
    // hydrate reply previews
    const replyIds = [...new Set(list.map(m => m.reply_to_id).filter(Boolean))];
    let replies = {};
    if (replyIds.length) {
      const [rrows] = await pool.query(
        `SELECT m.id, m.body, m.type, u.name AS sender_name FROM messages m LEFT JOIN users u ON u.id=m.sender_id WHERE m.id IN (?)`,
        [replyIds]);
      for (const r of rrows) replies[r.id] = r;
    }
    const out = list.reverse().map(m => {
      const h = hydrateMessage(m, req.user.id, reactions, votes, m.sender_name, m.sender_color);
      if (m.reply_to_id && replies[m.reply_to_id]) h.reply_to = replies[m.reply_to_id];
      return h;
    });
    res.json(out);
  });

  r.post('/:id/read', async (req, res) => {
    const convId = +req.params.id;
    if (!(await isParticipant(convId, req.user.id))) return res.status(403).json({});
    await pool.query(
      `UPDATE participants SET last_read_message_id=GREATEST(last_read_message_id, ?)
       WHERE conversation_id=? AND user_id=?`,
      [+(req.body?.lastId || 0), convId, req.user.id]
    );
    res.json({ ok: true });
  });

  r.patch('/:id/prefs', async (req, res) => {
    const convId = +req.params.id;
    const sets = [], vals = [];
    for (const k of ['favorite', 'archived', 'muted']) {
      if (k in (req.body || {})) { sets.push(`${k}=?`); vals.push(req.body[k] ? 1 : 0); }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    await pool.query(
      `UPDATE participants SET ${sets.join(',')} WHERE conversation_id=? AND user_id=?`,
      [...vals, convId, req.user.id]
    );
    res.json({ ok: true });
  });

  r.patch('/:id', async (req, res) => {
    const convId = +req.params.id;
    if (!(await isParticipant(convId, req.user.id))) return res.status(403).json({ error: 'Not a participant' });
    const [crows] = await pool.query('SELECT * FROM conversations WHERE id=?', [convId]);
    if (crows[0]?.type !== 'group') return res.status(400).json({ error: 'Only groups can be edited' });
    if (crows[0].created_by !== req.user.id) return res.status(403).json({ error: 'Only the creator can edit' });
    const name = req.body?.name !== undefined ? String(req.body.name).trim().slice(0, 100) : undefined;
    const about = req.body?.about !== undefined ? String(req.body.about).trim().slice(0, 200) : undefined;
    const sets = [], vals = [];
    if (name) { sets.push('name=?'); vals.push(name); }
    if (about !== undefined) { sets.push('about=?'); vals.push(about); }
    if (sets.length) await pool.query(`UPDATE conversations SET ${sets.join(',')} WHERE id=?`, [...vals, convId]);
    broadcastParticipants(io, convId);
    res.json({ ok: true });
  });

  r.post('/:id/participants', async (req, res) => {
    const convId = +req.params.id;
    const uid = req.user.id;
    if (!(await isParticipant(convId, uid))) return res.status(403).json({ error: 'Not a participant' });
    const [crows] = await pool.query('SELECT * FROM conversations WHERE id=?', [convId]);
    if (crows[0]?.type !== 'group') return res.status(400).json({ error: 'Not a group' });
    const newIds = [...new Set((req.body?.userIds || []).map(Number))].filter(x => x);
    for (const nid of newIds) {
      await pool.query('INSERT IGNORE INTO participants (conversation_id, user_id) VALUES (?,?)', [convId, nid]);
      await addSystemMessage(convId, uid, `Added ${await userName(nid)}`);
    }
    broadcastParticipants(io, convId);
    res.json({ ok: true });
  });

  r.delete('/:id/participants/:userId', async (req, res) => {
    const convId = +req.params.id;
    const uid = req.user.id;
    const [crows] = await pool.query('SELECT * FROM conversations WHERE id=?', [convId]);
    if (!crows[0] || crows[0].type !== 'group') return res.status(400).json({ error: 'Not a group' });
    if (crows[0].created_by !== uid) return res.status(403).json({ error: 'Only the creator can remove' });
    const target = +req.params.userId;
    if (target === uid) return res.status(400).json({ error: 'Cannot remove yourself this way' });
    await pool.query('DELETE FROM participants WHERE conversation_id=? AND user_id=?', [convId, target]);
    await addSystemMessage(convId, uid, `Removed ${await userName(target)}`);
    broadcastParticipants(io, convId);
    res.json({ ok: true });
  });

  r.delete('/:id/leave', async (req, res) => {
    const convId = +req.params.id;
    await pool.query('DELETE FROM participants WHERE conversation_id=? AND user_id=?', [convId, req.user.id]);
    await addSystemMessage(convId, req.user.id, `${req.user.name} left`);
    broadcastParticipants(io, convId);
    res.json({ ok: true });
  });

  // starred messages across conversations
  r.get('/starred/all', async (req, res) => {
    const uid = req.user.id;
    const [msgs] = await pool.query(
      `SELECT m.*, c.type AS conv_type, c.name AS conv_name FROM messages m
       JOIN conversations c ON c.id=m.conversation_id
       JOIN participants p ON p.conversation_id=c.id AND p.user_id=?
       WHERE JSON_CONTAINS(m.starred_by, CAST(? AS JSON)) AND m.deleted_at IS NULL
       ORDER BY m.id DESC LIMIT 100`,
      [uid, uid]
    );
    res.json(msgs.map(m => hydrateMessage(m, uid, [], [])));
  });

  r.post('/starred/:messageId', async (req, res) => {
    const uid = req.user.id;
    const mid = +req.params.messageId;
    const [mrows] = await pool.query('SELECT * FROM messages WHERE id=?', [mid]);
    const m = mrows[0];
    if (!m || !(await isParticipant(m.conversation_id, uid))) return res.status(403).json({ error: 'Not allowed' });
    const starred = new Set(m.starred_by || []);
    if (starred.has(uid)) starred.delete(uid); else starred.add(uid);
    await pool.query('UPDATE messages SET starred_by=? WHERE id=?',
      [JSON.stringify([...starred]), mid]);
    io.to(`conv:${m.conversation_id}`).emit('message:update', { id: mid, starred: starred.has(uid) });
    res.json({ starred: starred.has(uid) });
  });

  async function addSystemMessage(convId, actorId, text) {
    await pool.query(
      "INSERT INTO messages (conversation_id, sender_id, type, body) VALUES (?,?,'system',?)",
      [convId, actorId, text]
    );
    io.to(`conv:${convId}`).emit('message:new', { conversation_id: convId, type: 'system', body: text, system: true });
  }

  async function broadcastParticipants(io, convId) {
    const [members] = await pool.query(
      `SELECT u.id, u.name, u.about, u.avatar_color, u.avatar_url, p.role
       FROM participants p JOIN users u ON u.id=p.user_id WHERE p.conversation_id=? AND u.deleted=0`,
      [convId]
    );
    for (const m of members) {
      io.to(`user:${m.id}`).emit('conversation:update', { conversation_id: convId });
    }
  }

  return r;
}

export async function userName(id) {
  const [rows] = await pool.query('SELECT name FROM users WHERE id=?', [id]);
  return rows[0]?.name || 'someone';
}

export function hydrateMessage(m, meId, reactions = [], votes = [], senderName = null, senderColor = null) {
  const meta = m.meta || {};
  const out = {
    id: m.id, conversation_id: m.conversation_id, sender_id: m.sender_id,
    sender_name: senderName, sender_color: senderColor,
    type: m.deleted_at ? 'deleted' : m.type,
    body: m.deleted_at ? 'This message was deleted' : m.body,
    media_path: m.deleted_at ? null : m.media_path,
    media_name: m.media_name, media_size: m.media_size,
    reply_to_id: m.reply_to_id, forwarded: !!m.forwarded,
    edited: !!m.edited, starred: (m.starred_by || []).includes(meId),
    created_at: m.created_at,
    reactions: reactions.filter(r => r.message_id === m.id)
      .reduce((acc, r) => { (acc[r.emoji] = acc[r.emoji] || []).push(r.user_id); return acc; }, {}),
    meta
  };
  if (m.type === 'poll' && !m.deleted_at) {
    out.poll_votes = votes.filter(v => v.message_id === m.id)
      .reduce((acc, v) => { (acc[v.option_index] = acc[v.option_index] || []).push(v.user_id); return acc; }, {});
    out.my_vote = votes.find(v => v.message_id === m.id && v.user_id === meId)?.option_index ?? null;
  }
  return out;
}
