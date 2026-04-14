import { Router, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';
import type { AuthRequest } from '../middleware/auth';

function requireAdmin(req: AuthRequest, res: Response): boolean {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json(fail('Admin access required'));
    return false;
  }
  return true;
}

export const adminRouter = Router();

// GET /admin/stats — full admin dashboard data
adminRouter.get('/stats', (req: AuthRequest, res: Response) => {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json(fail('Admin access required'));
    return;
  }

  try {
    const db = getDb();

    // Users
    const users = db.prepare('SELECT id, email, name, role, tg_id, created_at FROM users ORDER BY id').all() as Array<{
      id: number; email: string; name: string; role: string; tg_id: string | null; created_at: string;
    }>;

    // Per-user stats
    const userStats = users.map(u => {
      const taskCount = (db.prepare('SELECT COUNT(*) as cnt FROM tasks WHERE user_id = ?').get(u.id) as { cnt: number }).cnt;
      const projectCount = (db.prepare('SELECT COUNT(*) as cnt FROM projects WHERE user_id = ?').get(u.id) as { cnt: number }).cnt;
      const meetingCount = (db.prepare('SELECT COUNT(*) as cnt FROM meetings WHERE user_id = ?').get(u.id) as { cnt: number }).cnt;
      const peopleCount = (db.prepare('SELECT COUNT(*) as cnt FROM people WHERE user_id = ?').get(u.id) as { cnt: number }).cnt;
      const ideaCount = (db.prepare('SELECT COUNT(*) as cnt FROM ideas WHERE user_id = ?').get(u.id) as { cnt: number }).cnt;
      const docCount = (db.prepare('SELECT COUNT(*) as cnt FROM documents WHERE user_id = ?').get(u.id) as { cnt: number }).cnt;
      const habitCount = (db.prepare('SELECT COUNT(*) as cnt FROM habits WHERE user_id = ?').get(u.id) as { cnt: number }).cnt;
      const goalCount = (db.prepare('SELECT COUNT(*) as cnt FROM goals WHERE user_id = ?').get(u.id) as { cnt: number }).cnt;

      // Disk usage (attachments)
      const diskBytes = (db.prepare(`
        SELECT COALESCE(SUM(a.size), 0) as bytes FROM attachments a
        LEFT JOIN documents d ON a.document_id = d.id
        LEFT JOIN tasks t ON a.task_id = t.id
        LEFT JOIN meetings m ON a.meeting_id = m.id
        WHERE d.user_id = ? OR t.user_id = ? OR m.user_id = ?
      `).get(u.id, u.id, u.id) as { bytes: number }).bytes;

      // AI tokens used
      const tokenStats = db.prepare(`
        SELECT
          COALESCE(SUM(tokens_in), 0) as total_in,
          COALESCE(SUM(tokens_out), 0) as total_out,
          COUNT(*) as calls
        FROM usage_logs WHERE user_id = ? AND type = 'ai_chat'
      `).get(u.id) as { total_in: number; total_out: number; calls: number } | undefined;

      // Also count system-wide (user_id IS NULL) if this is the main user
      const systemTokens = db.prepare(`
        SELECT
          COALESCE(SUM(tokens_in), 0) as total_in,
          COALESCE(SUM(tokens_out), 0) as total_out,
          COUNT(*) as calls
        FROM usage_logs WHERE user_id IS NULL AND type = 'ai_chat'
      `).get() as { total_in: number; total_out: number; calls: number };

      // Transcriptions
      const transcriptions = (db.prepare(`
        SELECT COUNT(*) as cnt FROM usage_logs WHERE user_id = ? AND type = 'transcription'
      `).get(u.id) as { cnt: number }).cnt;

      return {
        ...u,
        stats: {
          tasks: taskCount,
          projects: projectCount,
          meetings: meetingCount,
          people: peopleCount,
          ideas: ideaCount,
          documents: docCount,
          habits: habitCount,
          goals: goalCount,
        },
        disk_bytes: diskBytes,
        tokens: {
          input: (tokenStats?.total_in ?? 0) + (u.id === users[0]?.id ? systemTokens.total_in : 0),
          output: (tokenStats?.total_out ?? 0) + (u.id === users[0]?.id ? systemTokens.total_out : 0),
          calls: (tokenStats?.calls ?? 0) + (u.id === users[0]?.id ? systemTokens.calls : 0),
        },
        transcriptions,
      };
    });

    // DB file size
    let dbSizeBytes = 0;
    try {
      const fs = require('fs');
      const { config } = require('../config');
      const stat = fs.statSync(config.databasePath);
      dbSizeBytes = stat.size;
    } catch {}

    res.json(ok({
      users: userStats,
      db_size_bytes: dbSizeBytes,
      total_users: users.length,
    }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Error'));
  }
});

// GET /admin/users/:id — full user card for edit modal
adminRouter.get('/users/:id', (req: AuthRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const user = getDb().prepare('SELECT id, email, name, role, tg_id, created_at FROM users WHERE id = ?').get(Number(req.params['id']));
  if (!user) { res.status(404).json(fail('User not found')); return; }
  res.json(ok(user));
});

// PATCH /admin/users/:id — edit user fields (name, email, role, tg_id)
const UpdateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  role: z.enum(['user', 'admin']).optional(),
  tg_id: z.string().nullable().optional(),
});

adminRouter.patch('/users/:id', (req: AuthRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const parsed = UpdateUserSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const id = Number(req.params['id']);
  const existing = getDb().prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!existing) { res.status(404).json(fail('User not found')); return; }
  const fields = Object.entries(parsed.data).filter(([, v]) => v !== undefined).map(([k]) => `${k} = ?`);
  const values = Object.values(parsed.data).filter((v) => v !== undefined);
  if (fields.length === 0) { res.status(400).json(fail('No fields to update')); return; }
  getDb().prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  const updated = getDb().prepare('SELECT id, email, name, role, tg_id, created_at FROM users WHERE id = ?').get(id);
  res.json(ok(updated));
});

// POST /admin/users/:id/reset-password — set a new password for a user
adminRouter.post('/users/:id/reset-password', (req: AuthRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const parsed = z.object({ password: z.string().min(4) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail('Password too short (min 4 chars)')); return; }
  const id = Number(req.params['id']);
  const user = getDb().prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) { res.status(404).json(fail('User not found')); return; }
  const hash = bcrypt.hashSync(parsed.data.password, 10);
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  res.json(ok({ updated: true }));
});

// DELETE /admin/users/:id — delete user + all their data (cascade)
adminRouter.delete('/users/:id', (req: AuthRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params['id']);
  if (req.user && req.user.id === id) { res.status(400).json(fail('Нельзя удалить себя')); return; }
  const user = getDb().prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) { res.status(404).json(fail('User not found')); return; }
  const db = getDb();
  const tx = db.transaction(() => {
    for (const t of ['tasks', 'projects', 'meetings', 'people', 'ideas', 'documents', 'habits', 'goals']) {
      try { db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id); } catch {}
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  });
  tx();
  res.json(ok({ deleted: true }));
});
