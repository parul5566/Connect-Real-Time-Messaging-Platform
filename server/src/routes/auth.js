import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pool from '../db.js';
import { normalizePhone, signToken } from '../auth.js';

// OTP request rate limit: max 3 per hour per phone (in-memory)
const otpRequests = new Map();

export function setupAuthRoutes(app) {
  app.post('/api/auth/request-otp', async (req, res) => {
    const phone = normalizePhone(req.body?.phone);
    if (!phone) return res.status(400).json({ error: 'Enter a valid phone number' });
    const now = Date.now();
    const list = (otpRequests.get(phone) || []).filter(t => now - t < 3600_000);
    if (list.length >= 3) {
      return res.status(429).json({ error: 'Too many code requests. Please try again in an hour.' });
    }
    list.push(now);
    otpRequests.set(phone, list);

    const code = String(crypto.randomInt(100000, 999999));
    const hash = await bcrypt.hash(code, 8);
    const expires = new Date(Date.now() + 10 * 60_000);
    await pool.query(
      'INSERT INTO otp_codes (phone, code_hash, expires_at) VALUES (?,?,?)',
      [phone, hash, expires]
    );
    // Dev/demo mode: return the code to the client (no SMS gateway configured).
    res.json({ ok: true, devCode: code, expiresIn: 600 });
  });

  app.post('/api/auth/verify-otp', async (req, res) => {
    const phone = normalizePhone(req.body?.phone);
    const code = String(req.body?.code || '').trim();
    const name = String(req.body?.name || '').trim();
    if (!phone || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Enter the 6-digit code' });
    }
    const [rows] = await pool.query(
      'SELECT * FROM otp_codes WHERE phone=? AND used=0 AND expires_at>NOW() ORDER BY id DESC LIMIT 1',
      [phone]
    );
    const otp = rows[0];
    if (!otp || !(await bcrypt.compare(code, otp.code_hash))) {
      return res.status(400).json({ error: 'Incorrect or expired code. Please try again.' });
    }
    await pool.query('UPDATE otp_codes SET used=1 WHERE id=?', [otp.id]);

    let [users] = await pool.query('SELECT * FROM users WHERE phone=? AND deleted=0', [phone]);
    let user = users[0];
    if (!user) {
      if (!name) return res.status(400).json({ error: 'name_required' });
      if (name.length < 1 || name.length > 80) return res.status(400).json({ error: 'Enter a name (max 80 characters)' });
      const colors = ['#eed2bd', '#c8c4e9', '#bad8ea', '#e6d59d', '#d4b9d4', '#b8d3bc', '#edc1ba', '#accacc'];
      const color = colors[Math.floor(Math.random() * colors.length)];
      const [ins] = await pool.query(
        'INSERT INTO users (phone, name, avatar_color) VALUES (?,?,?)',
        [phone, name, color]
      );
      [users] = await pool.query('SELECT * FROM users WHERE id=?', [ins.insertId]);
      user = users[0];
      await seedNewUser(user);
    }
    // If two-step PIN is enabled, require it before issuing a token
    if (user.two_step_pin_hash) {
      if (!req.body.pin) return res.json({ ok: true, pin_required: true });
      const okPin = await bcrypt.compare(String(req.body.pin), user.two_step_pin_hash);
      if (!okPin) return res.status(400).json({ error: 'Incorrect PIN' });
    }
    const token = signToken(user);
    res.json({ ok: true, token, user: publicUser(user) });
  });

  app.post('/api/auth/verify-pin', async (req, res) => {
    const phone = normalizePhone(req.body?.phone);
    const pin = String(req.body?.pin || '');
    const [users] = await pool.query('SELECT * FROM users WHERE phone=? AND deleted=0', [phone]);
    const user = users[0];
    if (!user || !user.two_step_pin_hash) return res.status(400).json({ error: 'No PIN set for this account' });
    if (!(await bcrypt.compare(pin, user.two_step_pin_hash))) {
      return res.status(400).json({ error: 'Incorrect PIN' });
    }
    res.json({ ok: true, token: signToken(user), user: publicUser(user) });
  });
}

export function publicUser(u) {
  return {
    id: u.id, phone: u.phone, name: u.name, about: u.about,
    avatar_color: u.avatar_color, avatar_url: u.avatar_url,
    has_pin: !!u.two_step_pin_hash
  };
}

async function seedNewUser(user) {
  // Give every new user a conversation with each demo contact so the app is explorable.
  const demo = [
    { phone: '9100000001', name: 'Sofia Chen', about: 'Making room for the little things ✨', color: '#eed2bd' },
    { phone: '9100000002', name: 'Arjun Mehta', about: 'Coffee, code, repeat.', color: '#bad8ea' }
  ];
  for (const d of demo) {
    let [rows] = await pool.query('SELECT id FROM users WHERE phone=?', [d.phone]);
    let demoId;
    if (!rows[0]) {
      const [ins] = await pool.query(
        'INSERT INTO users (phone, name, about, avatar_color) VALUES (?,?,?,?)',
        [d.phone, d.name, d.about, d.color]
      );
      demoId = ins.insertId;
    } else demoId = rows[0].id;
    if (demoId === user.id) continue;
    // find or create direct conversation
    const [found] = await pool.query(
      `SELECT c.id FROM conversations c
       JOIN participants p1 ON p1.conversation_id=c.id AND p1.user_id=?
       JOIN participants p2 ON p2.conversation_id=c.id AND p2.user_id=?
       WHERE c.type='direct' LIMIT 1`,
      [user.id, demoId]
    );
    let convId;
    if (!found[0]) {
      const [ins] = await pool.query(
        "INSERT INTO conversations (type, created_by) VALUES ('direct', ?)", [user.id]
      );
      convId = ins.insertId;
      await pool.query('INSERT INTO participants (conversation_id, user_id, role) VALUES (?,?,"member"), (?,?,"member")',
        [convId, user.id, convId, demoId]);
      await pool.query(
        "INSERT INTO messages (conversation_id, sender_id, type, body) VALUES (?,?,'text',?)",
        [convId, demoId, `Hi ${user.name.split(' ')[0]}! Welcome to Connect 👋 Say hello anytime.`]
      );
    }
  }
}
