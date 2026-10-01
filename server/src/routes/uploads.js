import express from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import pool from '../db.js';
import { authRequired, isParticipant } from '../auth.js';

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/workspace/uploads';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED = {
  'image/jpeg': 'image', 'image/png': 'image', 'image/gif': 'image', 'image/webp': 'image',
  'audio/webm': 'audio', 'audio/ogg': 'audio', 'audio/mpeg': 'audio', 'audio/mp4': 'audio', 'audio/wav': 'audio',
  'application/pdf': 'file', 'text/plain': 'file',
  'application/msword': 'file',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'file',
  'application/vnd.ms-excel': 'file',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'file'
};

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 10).replace(/[^.\w]/g, '');
    cb(null, crypto.randomBytes(12).toString('hex') + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED[file.mimetype]) cb(null, true);
    else cb(new Error('Unsupported file type'));
  }
});

export default function uploadsRouter(io) {
  const r = express.Router();
  r.use(authRequired);

  r.post('/', (req, res) => {
    upload.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
      if (!req.file) return res.status(400).json({ error: 'No file provided' });
      res.json({
        ok: true,
        media_path: '/uploads/' + req.file.filename,
        media_name: (req.file.originalname || 'file').slice(0, 200),
        media_size: req.file.size,
        type: ALLOWED[req.file.mimetype] || 'file'
      });
    });
  });

  // storage usage for settings
  r.get('/usage', async (req, res) => {
    const [rows] = await pool.query(
      'SELECT COALESCE(SUM(media_size),0) AS bytes, COUNT(*) AS files FROM messages WHERE sender_id=? AND media_path IS NOT NULL',
      [req.user.id]);
    res.json(rows[0]);
  });

  return r;
}

export function staticUploads(app) {
  app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));
}
