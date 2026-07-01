import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getDb } from '../db/db';
import { config } from '../config';
import { ok, fail } from '@pis/shared';
import type { AuthRequest, AuthUser } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { sendVerificationEmail, generateCode } from '../services/email.service';

export const authRouter = Router();

// --- In-memory rate limiting for login/register ---
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function rateLimitLogin(req: AuthRequest, res: Response, next: () => void): void {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (entry && entry.resetAt > now && entry.count >= 5) {
    res.status(429).json({ success: false, error: 'Too many attempts. Try again in a minute.' });
    return;
  }
  if (!entry || entry.resetAt <= now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 60000 });
  } else {
    entry.count++;
  }
  next();
}

interface UserRow {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  role: string;
  created_at: string;
}

function signToken(user: UserRow): string {
  const payload: AuthUser = { id: user.id, email: user.email, name: user.name, role: user.role as 'admin' | 'user' };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '30d' });
}

// POST /auth/register
authRouter.post('/register', rateLimitLogin, (req: AuthRequest, res: Response) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) {
      res.status(400).json(fail('Email and password required'));
      return;
    }
    if (password.length < 6) {
      res.status(400).json(fail('Password must be at least 6 characters'));
      return;
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: number } | undefined;
    if (existing) {
      res.status(409).json(fail('Email already registered'));
      return;
    }

    const hash = bcrypt.hashSync(password, 10);
    // First user becomes admin
    const userCount = (db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number }).cnt;
    const role = userCount === 0 ? 'admin' : 'user';

    const normalEmail = email.toLowerCase().trim();
    const result = db.prepare('INSERT INTO users (email, password_hash, name, role, email_verified) VALUES (?, ?, ?, ?, 0)').run(
      normalEmail,
      hash,
      (name || email.split('@')[0] || 'User').trim(),
      role
    );

    // Send verification code
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO verification_codes (email, code, type, expires_at) VALUES (?, ?, ?, ?)').run(normalEmail, code, 'register', expiresAt);
    sendVerificationEmail(normalEmail, code, 'register').catch(err => console.error('[auth] email send failed:', err));

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid) as UserRow;
    const token = signToken(user);

    res.json(ok({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role }, needsVerification: true }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Registration error'));
  }
});

// POST /auth/login
authRouter.post('/login', rateLimitLogin, (req: AuthRequest, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json(fail('Email and password required'));
      return;
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim()) as UserRow | undefined;
    if (!user) {
      res.status(401).json(fail('Invalid email or password'));
      return;
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
      res.status(401).json(fail('Invalid email or password'));
      return;
    }

    const token = signToken(user);
    res.json(ok({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Login error'));
  }
});

// GET /auth/me
authRouter.get('/me', requireAuth, (req: AuthRequest, res: Response) => {
  res.json(ok(req.user));
});

// PATCH /auth/me — update profile
authRouter.patch('/me', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const { name, password } = req.body;
    const db = getDb();

    if (name) {
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name.trim(), req.user!.id);
    }
    if (password) {
      if (password.length < 6) {
        res.status(400).json(fail('Password must be at least 6 characters'));
        return;
      }
      const hash = bcrypt.hashSync(password, 10);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user!.id);
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as UserRow;
    const token = signToken(user);
    res.json(ok({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Update error'));
  }
});

// POST /auth/verify-email
authRouter.post('/verify-email', (req: AuthRequest, res: Response) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) { res.status(400).json(fail('Email and code required')); return; }
    const db = getDb();
    const normalEmail = email.toLowerCase().trim();
    const record = db.prepare(
      "SELECT * FROM verification_codes WHERE email = ? AND code = ? AND type = 'register' AND used = 0 AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1"
    ).get(normalEmail, String(code)) as { id: number } | undefined;
    if (!record) { res.status(400).json(fail('Invalid or expired code')); return; }
    db.prepare('UPDATE verification_codes SET used = 1 WHERE id = ?').run(record.id);
    db.prepare('UPDATE users SET email_verified = 1 WHERE email = ?').run(normalEmail);
    res.json(ok({ verified: true }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Verification error'));
  }
});

// POST /auth/resend-code
authRouter.post('/resend-code', rateLimitLogin, (req: AuthRequest, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) { res.status(400).json(fail('Email required')); return; }
    const db = getDb();
    const normalEmail = email.toLowerCase().trim();
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(normalEmail) as { id: number } | undefined;
    if (!user) { res.json(ok({ sent: true })); return; } // Don't leak whether email exists
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO verification_codes (email, code, type, expires_at) VALUES (?, ?, ?, ?)').run(normalEmail, code, 'register', expiresAt);
    sendVerificationEmail(normalEmail, code, 'register').catch(err => console.error('[auth] resend email failed:', err));
    res.json(ok({ sent: true }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Resend error'));
  }
});

// POST /auth/forgot-password
authRouter.post('/forgot-password', rateLimitLogin, (req: AuthRequest, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) { res.status(400).json(fail('Email required')); return; }
    const db = getDb();
    const normalEmail = email.toLowerCase().trim();
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(normalEmail) as { id: number } | undefined;
    if (!user) { res.json(ok({ sent: true })); return; } // Don't leak
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO verification_codes (email, code, type, expires_at) VALUES (?, ?, ?, ?)').run(normalEmail, code, 'reset', expiresAt);
    sendVerificationEmail(normalEmail, code, 'reset').catch(err => console.error('[auth] reset email failed:', err));
    res.json(ok({ sent: true }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Forgot password error'));
  }
});

// POST /auth/reset-password
authRouter.post('/reset-password', (req: AuthRequest, res: Response) => {
  try {
    const { email, code, password } = req.body;
    if (!email || !code || !password) { res.status(400).json(fail('Email, code and new password required')); return; }
    if (password.length < 6) { res.status(400).json(fail('Password must be at least 6 characters')); return; }
    const db = getDb();
    const normalEmail = email.toLowerCase().trim();
    const record = db.prepare(
      "SELECT * FROM verification_codes WHERE email = ? AND code = ? AND type = 'reset' AND used = 0 AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1"
    ).get(normalEmail, String(code)) as { id: number } | undefined;
    if (!record) { res.status(400).json(fail('Invalid or expired code')); return; }
    db.prepare('UPDATE verification_codes SET used = 1 WHERE id = ?').run(record.id);
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash = ?, email_verified = 1 WHERE email = ?').run(hash, normalEmail);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalEmail) as UserRow;
    const token = signToken(user);
    res.json(ok({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Reset error'));
  }
});

// GET /auth/users — admin only
authRouter.get('/users', requireAuth, (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') {
    res.status(403).json(fail('Admin access required'));
    return;
  }
  const db = getDb();
  const users = db.prepare('SELECT id, email, name, role, created_at FROM users ORDER BY id').all();
  res.json(ok(users));
});
