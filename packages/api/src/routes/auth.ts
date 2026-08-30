import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { queryAll, queryOne, execute } from '../db/db';
import { config } from '../config';
import { ok, fail } from '@pis/shared';
import type { AuthRequest, AuthUser } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { sendVerificationEmail, generateCode } from '../services/email.service';
import { getUserPlan, getAiUsageToday } from '../middleware/plan';

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
  plan: string;
  created_at: string;
}

function signToken(user: UserRow): string {
  const payload: AuthUser = { id: user.id, email: user.email, name: user.name, role: user.role as 'admin' | 'user' };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '30d' });
}

// POST /auth/register
authRouter.post('/register', rateLimitLogin, async (req: AuthRequest, res: Response) => {
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

    const existing = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = $1', [email]);
    if (existing) {
      res.status(409).json(fail('Email already registered'));
      return;
    }

    const hash = bcrypt.hashSync(password, 10);
    // First user becomes admin
    const countRow = await queryOne<{ cnt: string }>('SELECT COUNT(*) as cnt FROM users');
    const userCount = Number(countRow?.cnt ?? 0);
    const role = userCount === 0 ? 'admin' : 'user';

    const normalEmail = email.toLowerCase().trim();
    const inserted = await queryOne<{ id: number }>(
      'INSERT INTO users (email, password_hash, name, role, email_verified) VALUES ($1, $2, $3, $4, 0) RETURNING id',
      [
        normalEmail,
        hash,
        (name || email.split('@')[0] || 'User').trim(),
        role,
      ]
    );

    // Send verification code
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await execute(
      'INSERT INTO verification_codes (email, code, type, expires_at) VALUES ($1, $2, $3, $4)',
      [normalEmail, code, 'register', expiresAt]
    );
    sendVerificationEmail(normalEmail, code, 'register').catch(err => console.error('[auth] email send failed:', err));

    const user = await queryOne<UserRow>('SELECT * FROM users WHERE id = $1', [inserted!.id]);
    const token = signToken(user!);

    res.json(ok({ token, user: { id: user!.id, email: user!.email, name: user!.name, role: user!.role, plan: user!.plan || 'free' }, needsVerification: true }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Registration error'));
  }
});

// POST /auth/login
authRouter.post('/login', rateLimitLogin, async (req: AuthRequest, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json(fail('Email and password required'));
      return;
    }

    const user = await queryOne<UserRow>('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (!user) {
      res.status(401).json(fail('Invalid email or password'));
      return;
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
      res.status(401).json(fail('Invalid email or password'));
      return;
    }

    const token = signToken(user);
    res.json(ok({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, plan: user.plan || 'free' } }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Login error'));
  }
});

// GET /auth/me
authRouter.get('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  const plan = await getUserPlan(req.user!.id);
  res.json(ok({ ...req.user, plan }));
});

// PATCH /auth/me — update profile
authRouter.patch('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { name, password } = req.body;

    if (name) {
      await execute('UPDATE users SET name = $1 WHERE id = $2', [name.trim(), req.user!.id]);
    }
    if (password) {
      if (password.length < 6) {
        res.status(400).json(fail('Password must be at least 6 characters'));
        return;
      }
      const hash = bcrypt.hashSync(password, 10);
      await execute('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user!.id]);
    }

    const user = await queryOne<UserRow>('SELECT * FROM users WHERE id = $1', [req.user!.id]);
    const token = signToken(user!);
    res.json(ok({ token, user: { id: user!.id, email: user!.email, name: user!.name, role: user!.role, plan: user!.plan || 'free' } }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Update error'));
  }
});

// POST /auth/verify-email
authRouter.post('/verify-email', async (req: AuthRequest, res: Response) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) { res.status(400).json(fail('Email and code required')); return; }
    const normalEmail = email.toLowerCase().trim();
    const record = await queryOne<{ id: number }>(
      "SELECT * FROM verification_codes WHERE email = $1 AND code = $2 AND type = 'register' AND used = 0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1",
      [normalEmail, String(code)]
    );
    if (!record) { res.status(400).json(fail('Invalid or expired code')); return; }
    await execute('UPDATE verification_codes SET used = 1 WHERE id = $1', [record.id]);
    await execute('UPDATE users SET email_verified = 1 WHERE email = $1', [normalEmail]);
    res.json(ok({ verified: true }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Verification error'));
  }
});

// POST /auth/resend-code
authRouter.post('/resend-code', rateLimitLogin, async (req: AuthRequest, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) { res.status(400).json(fail('Email required')); return; }
    const normalEmail = email.toLowerCase().trim();
    const user = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = $1', [normalEmail]);
    if (!user) { res.json(ok({ sent: true })); return; } // Don't leak whether email exists
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await execute(
      'INSERT INTO verification_codes (email, code, type, expires_at) VALUES ($1, $2, $3, $4)',
      [normalEmail, code, 'register', expiresAt]
    );
    sendVerificationEmail(normalEmail, code, 'register').catch(err => console.error('[auth] resend email failed:', err));
    res.json(ok({ sent: true }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Resend error'));
  }
});

// POST /auth/forgot-password
authRouter.post('/forgot-password', rateLimitLogin, async (req: AuthRequest, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) { res.status(400).json(fail('Email required')); return; }
    const normalEmail = email.toLowerCase().trim();
    const user = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = $1', [normalEmail]);
    if (!user) { res.json(ok({ sent: true })); return; } // Don't leak
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await execute(
      'INSERT INTO verification_codes (email, code, type, expires_at) VALUES ($1, $2, $3, $4)',
      [normalEmail, code, 'reset', expiresAt]
    );
    sendVerificationEmail(normalEmail, code, 'reset').catch(err => console.error('[auth] reset email failed:', err));
    res.json(ok({ sent: true }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Forgot password error'));
  }
});

// POST /auth/reset-password
authRouter.post('/reset-password', async (req: AuthRequest, res: Response) => {
  try {
    const { email, code, password } = req.body;
    if (!email || !code || !password) { res.status(400).json(fail('Email, code and new password required')); return; }
    if (password.length < 6) { res.status(400).json(fail('Password must be at least 6 characters')); return; }
    const normalEmail = email.toLowerCase().trim();
    const record = await queryOne<{ id: number }>(
      "SELECT * FROM verification_codes WHERE email = $1 AND code = $2 AND type = 'reset' AND used = 0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1",
      [normalEmail, String(code)]
    );
    if (!record) { res.status(400).json(fail('Invalid or expired code')); return; }
    await execute('UPDATE verification_codes SET used = 1 WHERE id = $1', [record.id]);
    const hash = bcrypt.hashSync(password, 10);
    await execute('UPDATE users SET password_hash = $1, email_verified = 1 WHERE email = $2', [hash, normalEmail]);
    const user = await queryOne<UserRow>('SELECT * FROM users WHERE email = $1', [normalEmail]);
    const token = signToken(user!);
    res.json(ok({ token, user: { id: user!.id, email: user!.email, name: user!.name, role: user!.role, plan: user!.plan || 'free' } }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Reset error'));
  }
});

// GET /auth/plan — returns current plan and AI usage
authRouter.get('/plan', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const plan = await getUserPlan(userId);
    const aiUsedToday = await getAiUsageToday(userId);
    const aiLimit = plan === 'pro_max' ? null : 50;
    res.json(ok({ plan, ai_used_today: aiUsedToday, ai_limit: aiLimit }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Plan error'));
  }
});

// POST /auth/plan — switch plan (no payment for now)
authRouter.post('/plan', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { plan } = req.body as { plan?: string };
    if (!plan || !['free', 'pro_max'].includes(plan)) {
      res.status(400).json(fail('Invalid plan. Use "free" or "pro_max"'));
      return;
    }
    await execute('UPDATE users SET plan = $1 WHERE id = $2', [plan, req.user!.id]);
    const aiUsedToday = await getAiUsageToday(req.user!.id);
    const aiLimit = plan === 'pro_max' ? null : 50;
    res.json(ok({ plan, ai_used_today: aiUsedToday, ai_limit: aiLimit }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Plan update error'));
  }
});

// GET /auth/users — admin only
authRouter.get('/users', requireAuth, async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') {
    res.status(403).json(fail('Admin access required'));
    return;
  }
  const users = await queryAll('SELECT id, email, name, role, created_at FROM users ORDER BY id');
  res.json(ok(users));
});
