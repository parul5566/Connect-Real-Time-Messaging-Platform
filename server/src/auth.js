import jwt from 'jsonwebtoken';
import pool from './db.js';

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export function normalizePhone(raw) {
  const digits = String(raw || '').replace(/[^\d]/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return digits;
}

export function signToken(user) {
  return jwt.sign(
    { uid: user.id, tv: user.token_version || 0 },
    SECRET,
    { expiresIn: '7d' }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

export async function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Not authenticated' });
  const [rows] = await pool.query(
    'SELECT * FROM users WHERE id=? AND deleted=0',
    [payload.uid]
  );
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  if ((user.token_version || 0) !== (payload.tv || 0)) {
    return res.status(401).json({ error: 'Session expired' });
  }
  req.user = user;
  next();
}

export async function isParticipant(convId, userId) {
  const [rows] = await pool.query(
    'SELECT 1 FROM participants WHERE conversation_id=? AND user_id=?',
    [convId, userId]
  );
  return rows.length > 0;
}

export async function isBlocked(aId, bId) {
  const [rows] = await pool.query('SELECT blocked_users FROM users WHERE id=?', [aId]);
  const blocked = rows[0]?.blocked_users || [];
  return blocked.includes(bId);
}
