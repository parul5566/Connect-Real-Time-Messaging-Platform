import express from 'express';
import pool from '../db.js';
import { authRequired } from '../auth.js';

export default function communitiesRouter(io) {
  const r = express.Router();
  r.use(authRequired);

  r.get('/', async (req, res) => {
    const uid = req.user.id;
    const [rows] = await pool.query(
      `SELECT cm.* FROM communities cm
       JOIN community_groups cg ON cg.community_id=cm.id
       JOIN participants p ON p.conversation_id=cg.conversation_id AND p.user_id=?
       GROUP BY cm.id`, [uid]);
    const out = [];
    for (const c of rows) {
      const [groups] = await pool.query(
        `SELECT cg.id, cg.conversation_id, cg.is_announcements, cv.name, cv.about
         FROM community_groups cg JOIN conversations cv ON cv.id=cg.conversation_id
         WHERE cg.community_id=?`, [c.id]);
      out.push({ ...c, is_owner: c.created_by === uid, groups });
    }
    res.json(out);
  });

  r.post('/', async (req, res) => {
    const uid = req.user.id;
    const name = String(req.body?.name || '').trim().slice(0, 100);
    const description = String(req.body?.description || '').trim().slice(0, 200);
    const memberIds = [...new Set((req.body?.memberIds || []).map(Number).filter(x => x && x !== uid))].slice(0, 100);
    if (!name) return res.status(400).json({ error: 'Enter a community name' });
    const [ins] = await pool.query(
      'INSERT INTO communities (name, description, created_by) VALUES (?,?,?)', [name, description, uid]);
    // Announcements group
    const [ann] = await pool.query(
      "INSERT INTO conversations (type, name, about, created_by) VALUES ('group',?,?,?)",
      [`${name} · Announcements`, 'Important updates for everyone', uid]);
    await pool.query('INSERT INTO community_groups (community_id, conversation_id, is_announcements) VALUES (?,?,1)',
      [ins.insertId, ann.insertId]);
    const memberSql = [[ann.insertId, uid, 'admin']];
    for (const m of memberIds) memberSql.push([ann.insertId, m, 'member']);
    for (const row of memberSql) {
      await pool.query('INSERT IGNORE INTO participants (conversation_id, user_id, role) VALUES (?,?,?)', row);
    }
    await pool.query("INSERT INTO messages (conversation_id, sender_id, type, body) VALUES (?,?,'system',?)",
      [ann.insertId, uid, `Welcome to ${name}! This is the announcements space.`]);
    for (const m of [uid, ...memberIds]) io.to(`user:${m}`).emit('conversation:update', { conversation_id: ann.insertId });
    res.json({ id: ins.insertId, announcements_conversation_id: ann.insertId });
  });

  r.post('/:id/groups', async (req, res) => {
    const uid = req.user.id;
    const name = String(req.body?.name || '').trim().slice(0, 100);
    if (!name) return res.status(400).json({ error: 'Enter a group name' });
    const [cm] = await pool.query('SELECT * FROM communities WHERE id=?', [+req.params.id]);
    if (!cm[0]) return res.status(404).json({ error: 'Community not found' });
    if (cm[0].created_by !== uid) return res.status(403).json({ error: 'Only the creator can add groups' });
    const [conv] = await pool.query(
      "INSERT INTO conversations (type, name, about, created_by) VALUES ('group',?, 'Community group', ?)",
      [name, uid]);
    await pool.query('INSERT INTO community_groups (community_id, conversation_id, is_announcements) VALUES (?,?,0)',
      [cm[0].id, conv.insertId]);
    // add all announcements members
    const [anns] = await pool.query(
      `SELECT cg.conversation_id FROM community_groups cg WHERE cg.community_id=? AND cg.is_announcements=1`, [cm[0].id]);
    if (anns[0]) {
      const [members] = await pool.query('SELECT user_id, role FROM participants WHERE conversation_id=?', [anns[0].conversation_id]);
      for (const m of members) {
        await pool.query('INSERT IGNORE INTO participants (conversation_id, user_id, role) VALUES (?,?,?)',
          [conv.insertId, m.user_id, m.role]);
        io.to(`user:${m.user_id}`).emit('conversation:update', { conversation_id: conv.insertId });
      }
    }
    res.json({ id: conv.insertId });
  });

  r.post('/:id/invite', async (req, res) => {
    const uid = req.user.id;
    const userIds = [...new Set((req.body?.userIds || []).map(Number).filter(x => x))];
    const [cm] = await pool.query('SELECT * FROM communities WHERE id=?', [+req.params.id]);
    if (!cm[0]) return res.status(404).json({ error: 'Community not found' });
    if (cm[0].created_by !== uid) return res.status(403).json({ error: 'Only the creator can invite' });
    const [groups] = await pool.query('SELECT conversation_id FROM community_groups WHERE community_id=?', [cm[0].id]);
    for (const g of groups) {
      for (const u of userIds) {
        await pool.query('INSERT IGNORE INTO participants (conversation_id, user_id) VALUES (?,?)', [g.conversation_id, u]);
        io.to(`user:${u}`).emit('conversation:update', { conversation_id: g.conversation_id });
      }
    }
    res.json({ ok: true });
  });

  return r;
}
