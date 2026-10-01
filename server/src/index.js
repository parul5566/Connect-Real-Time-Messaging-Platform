import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import pool, { initSchema } from './db.js';
import { setupAuthRoutes } from './routes/auth.js';
import { authRequired, verifyToken } from './auth.js';
import usersRouter, { safeUser } from './routes/users.js';
import conversationsRouter from './routes/conversations.js';
import messagesRouter from './routes/messages.js';
import uploadsRouter, { staticUploads } from './routes/uploads.js';
import statusesRouter from './routes/status.js';
import channelsRouter from './routes/channels.js';
import communitiesRouter from './routes/communities.js';
import callsRouter from './routes/calls.js';
import aiRouter from './routes/ai.js';
import { askAI } from './ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = +process.env.PORT || 3000;

// Load env vars written by the platform into the container environment if
// the managed .env file has not been materialized yet (belt & braces).
if (!process.env.DB_NAME) {
  try {
    const fs = await import('fs');
    const raw = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {}
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6, cors: { origin: true } });

app.set('trust proxy', false);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));

const apiLimiter = rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false });
app.use('/api', apiLimiter);
const otpLimiter = rateLimit({ windowMs: 60_000, max: 8, standardHeaders: true, legacyHeaders: false });

await initSchema();
setupAuthRoutes(app);
// extra limiter specifically on otp endpoint (on top of in-app 3/hour per phone)
const origRequest = app._router;
app.use('/api/auth/request-otp', otpLimiter);

// online presence: userId -> Set(socketId)
const onlineUsers = new Map();

app.use('/api/users', usersRouter(io));
app.use('/api/conversations', conversationsRouter(io, onlineUsers));
app.use('/api/messages', messagesRouter(io, onlineUsers));
app.use('/api/upload', uploadsRouter(io));
app.use('/api/statuses', statusesRouter(io));
app.use('/api/channels', channelsRouter(io));
app.use('/api/communities', communitiesRouter(io));
app.use('/api/calls', callsRouter(io, onlineUsers));
app.use('/api/ai', aiRouter());

// AI ask (SSE streaming)
app.post('/api/ai/ask', authRequired, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  try {
    await askAI(req, res, io);
  } catch (e) {
    res.write(`data: ${JSON.stringify({ stage: 'error', error: 'The assistant is unavailable right now. Please try again.' })}\n\n`);
    res.end();
  }
});

// Simple JSON wrapper over the SSE pipeline
app.post('/api/ai/chat', authRequired, async (req, res) => {
  const chunks = [];
  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);
  let donePayload = null;
  res.write = (chunk) => {
    try {
      const s = String(chunk);
      if (s.startsWith('data: ')) {
        const evt = JSON.parse(s.slice(6));
        if (evt.done) donePayload = evt;
        else if (evt.delta && donePayload == null) chunks.push(evt.delta);
      }
    } catch {}
    return true;
  };
  res.end = () => {
    res.write = origWrite;
    const text = donePayload?.text || chunks.join('');
    origEnd(JSON.stringify({ reply: text, blocked: !!donePayload?.blocked, noMatch: !!donePayload?.noMatch, error: !!donePayload?.error, sources: donePayload?.sources || [] }));
  };
  req.body.question = req.body?.message || req.body?.question || '';
  try {
    await askAI(req, res, io);
  } catch (e) {
    res.write = origWrite;
    res.status(502).json({ reply: 'The assistant is unavailable right now. Please try again.', error: true });
  }
});

staticUploads(app);

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next();
  res.status(500).json({ error: 'Something went wrong' });
});

// static frontend
const pubDir = path.join(__dirname, '../../public');
app.use(express.static(pubDir));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/') || req.path.startsWith('/socket.io/')) return next();
  res.sendFile(path.join(pubDir, 'index.html'));
});

// ---- Socket.IO ----
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const payload = token && verifyToken(token);
  if (!payload) return next(new Error('unauthorized'));
  socket.userId = payload.uid;
  next();
});

io.on('connection', async (socket) => {
  const uid = socket.userId;
  if (!onlineUsers.has(uid)) onlineUsers.set(uid, new Set());
  onlineUsers.get(uid).add(socket.id);
  socket.join(`user:${uid}`);
  const [convs] = await pool.query('SELECT conversation_id FROM participants WHERE user_id=?', [uid]);
  for (const c of convs) socket.join(`conv:${c.conversation_id}`);
  await pool.query('UPDATE users SET last_seen_at=NOW() WHERE id=?', [uid]);
  io.emit('presence', { userId: uid, online: true });

  socket.on('typing', ({ conversationId, typing }) => {
    socket.to(`conv:${+conversationId}`).emit('typing', { userId: uid, conversationId: +conversationId, typing: !!typing });
  });

  socket.on('message:delivered', async ({ conversationId }) => {
    await pool.query(
      `INSERT IGNORE INTO message_receipts (message_id, user_id, delivered_at)
       SELECT id, ?, NOW() FROM messages WHERE conversation_id=? AND sender_id<>?`,
      [uid, +conversationId, uid]);
    socket.to(`conv:${+conversationId}`).emit('receipts:update', { conversationId: +conversationId });
  });

  socket.on('message:read', async ({ conversationId, lastId }) => {
    await pool.query(
      `UPDATE participants SET last_read_message_id=GREATEST(last_read_message_id, ?) WHERE conversation_id=? AND user_id=?`,
      [+lastId || 0, +conversationId, uid]);
    await pool.query(
      `UPDATE message_receipts mr JOIN messages m ON m.id=mr.message_id
       SET mr.read_at=NOW() WHERE m.conversation_id=? AND mr.user_id=? AND m.sender_id<>?`,
      [+conversationId, uid, uid]);
    socket.to(`conv:${+conversationId}`).emit('receipts:update', { conversationId: +conversationId, readBy: uid });
  });

  // ---- WebRTC signaling ----
  socket.on('call:accept', ({ callId, to }) => {
    io.to(`user:${+to}`).emit('call:accepted', { callId, from: uid });
  });
  socket.on('call:decline', async ({ callId, to }) => {
    io.to(`user:${+to}`).emit('call:declined', { callId, from: uid });
    await pool.query("UPDATE calls SET status='declined', ended_at=NOW() WHERE id=?", [callId]);
  });
  socket.on('call:cancel', async ({ callId, to }) => {
    io.to(`user:${+to}`).emit('call:cancelled', { callId, from: uid });
    await pool.query("UPDATE calls SET status='missed', ended_at=NOW() WHERE id=?", [callId]);
  });
  socket.on('call:end', async ({ callId, to, duration }) => {
    io.to(`user:${+to}`).emit('call:ended', { callId, from: uid });
    await pool.query("UPDATE calls SET status='completed', ended_at=NOW(), duration_secs=? WHERE id=? AND status='ringing'",
      [+duration || 0, callId]);
  });
  socket.on('call:sdp', ({ to, sdp }) => io.to(`user:${+to}`).emit('call:sdp', { from: uid, sdp }));
  socket.on('call:ice', ({ to, candidate }) => io.to(`user:${+to}`).emit('call:ice', { from: uid, candidate }));

  socket.on('disconnect', () => {
    const set = onlineUsers.get(uid);
    if (set) {
      set.delete(socket.id);
      if (!set.size) {
        onlineUsers.delete(uid);
        pool.query('UPDATE users SET last_seen_at=NOW() WHERE id=?', [uid]).catch(() => {});
        io.emit('presence', { userId: uid, online: false, at: new Date() });
      }
    }
  });
});

server.listen(PORT, () => console.log(`Connect server listening on :${PORT}`));
