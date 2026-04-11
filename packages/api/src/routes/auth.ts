import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getDb } from '../db/db';
import { config } from '../config';
import { ok, fail } from '@pis/shared';
import type { AuthRequest, AuthUser } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';

export const authRouter = Router();

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
authRouter.post('/register', (req: AuthRequest, res: Response) => {
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

    const result = db.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)').run(
      email.toLowerCase().trim(),
      hash,
      (name || email.split('@')[0] || 'User').trim(),
      role
    );

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid) as UserRow;
    const token = signToken(user);

    res.json(ok({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Registration error'));
  }
});

// POST /auth/login
authRouter.post('/login', (req: AuthRequest, res: Response) => {
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
