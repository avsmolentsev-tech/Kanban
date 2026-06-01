import { Router, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { queryAll, queryOne, execute, getPool } from '../db/db';
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
adminRouter.get('/stats', async (req: AuthRequest, res: Response) => {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json(fail('Admin access required'));
    return;
  }

  try {
    // Users
    const users = await queryAll<{
      id: number; email: string; name: string; role: string; tg_id: string | null; created_at: string;
    }>('SELECT id, email, name, role, tg_id, created_at FROM users ORDER BY id');

    // Per-user stats
    const userStats = await Promise.all(users.map(async (u) => {
      const taskCountRow = await queryOne<{ cnt: string }>('SELECT COUNT(*) as cnt FROM tasks WHERE user_id = $1', [u.id]);
      const taskCount = Number(taskCountRow?.cnt ?? 0);

      const projectCountRow = await queryOne<{ cnt: string }>('SELECT COUNT(*) as cnt FROM projects WHERE user_id = $1', [u.id]);
      const projectCount = Number(projectCountRow?.cnt ?? 0);

      const meetingCountRow = await queryOne<{ cnt: string }>('SELECT COUNT(*) as cnt FROM meetings WHERE user_id = $1', [u.id]);
      const meetingCount = Number(meetingCountRow?.cnt ?? 0);

      const peopleCountRow = await queryOne<{ cnt: string }>('SELECT COUNT(*) as cnt FROM people WHERE user_id = $1', [u.id]);
      const peopleCount = Number(peopleCountRow?.cnt ?? 0);

      const ideaCountRow = await queryOne<{ cnt: string }>('SELECT COUNT(*) as cnt FROM ideas WHERE user_id = $1', [u.id]);
      const ideaCount = Number(ideaCountRow?.cnt ?? 0);

      const docCountRow = await queryOne<{ cnt: string }>('SELECT COUNT(*) as cnt FROM documents WHERE user_id = $1', [u.id]);
      const docCount = Number(docCountRow?.cnt ?? 0);

      const habitCountRow = await queryOne<{ cnt: string }>('SELECT COUNT(*) as cnt FROM habits WHERE user_id = $1', [u.id]);
      const habitCount = Number(habitCountRow?.cnt ?? 0);

      const goalCountRow = await queryOne<{ cnt: string }>('SELECT COUNT(*) as cnt FROM goals WHERE user_id = $1', [u.id]);
      const goalCount = Number(goalCountRow?.cnt ?? 0);

      // Disk usage (attachments)
      const diskRow = await queryOne<{ bytes: string }>(`
        SELECT COALESCE(SUM(a.size), 0) as bytes FROM attachments a
        LEFT JOIN documents d ON a.document_id = d.id
        LEFT JOIN tasks t ON a.task_id = t.id
        LEFT JOIN meetings m ON a.meeting_id = m.id
        WHERE d.user_id = $1 OR t.user_id = $2 OR m.user_id = $3
      `, [u.id, u.id, u.id]);
      const diskBytes = Number(diskRow?.bytes ?? 0);

      // AI tokens used
      const tokenStats = await queryOne<{ total_in: string; total_out: string; calls: string }>(`
        SELECT
          COALESCE(SUM(tokens_in), 0) as total_in,
          COALESCE(SUM(tokens_out), 0) as total_out,
          COUNT(*) as calls
        FROM usage_logs WHERE user_id = $1 AND type = 'ai_chat'
      `, [u.id]);

      // Also count system-wide (user_id IS NULL) if this is the main user
      const systemTokens = await queryOne<{ total_in: string; total_out: string; calls: string }>(`
        SELECT
          COALESCE(SUM(tokens_in), 0) as total_in,
          COALESCE(SUM(tokens_out), 0) as total_out,
          COUNT(*) as calls
        FROM usage_logs WHERE user_id IS NULL AND type = 'ai_chat'
      `);

      // Transcriptions
      const transcriptionsRow = await queryOne<{ cnt: string }>(`
        SELECT COUNT(*) as cnt FROM usage_logs WHERE user_id = $1 AND type = 'transcription'
      `, [u.id]);
      const transcriptions = Number(transcriptionsRow?.cnt ?? 0);

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
          input: Number(tokenStats?.total_in ?? 0) + (u.id === users[0]?.id ? Number(systemTokens?.total_in ?? 0) : 0),
          output: Number(tokenStats?.total_out ?? 0) + (u.id === users[0]?.id ? Number(systemTokens?.total_out ?? 0) : 0),
          calls: Number(tokenStats?.calls ?? 0) + (u.id === users[0]?.id ? Number(systemTokens?.calls ?? 0) : 0),
        },
        transcriptions,
      };
    }));

    // DB size via PostgreSQL
    let dbSizeBytes = 0;
    try {
      const sizeRow = await queryOne<{ size: string }>("SELECT pg_database_size('clarity_space') as size");
      dbSizeBytes = Number(sizeRow?.size ?? 0);
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
adminRouter.get('/users/:id', async (req: AuthRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const user = await queryOne('SELECT id, email, name, role, tg_id, created_at FROM users WHERE id = $1', [Number(req.params['id'])]);
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

adminRouter.patch('/users/:id', async (req: AuthRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const parsed = UpdateUserSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const id = Number(req.params['id']);
  const existing = await queryOne('SELECT id FROM users WHERE id = $1', [id]);
  if (!existing) { res.status(404).json(fail('User not found')); return; }
  const entries = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) { res.status(400).json(fail('No fields to update')); return; }
  const fields = entries.map(([k], i) => `${k} = $${i + 1}`);
  const values = entries.map(([, v]) => v);
  await execute(`UPDATE users SET ${fields.join(', ')} WHERE id = $${entries.length + 1}`, [...values, id]);
  const updated = await queryOne('SELECT id, email, name, role, tg_id, created_at FROM users WHERE id = $1', [id]);
  res.json(ok(updated));
});

// POST /admin/users/:id/reset-password — set a new password for a user
adminRouter.post('/users/:id/reset-password', async (req: AuthRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const parsed = z.object({ password: z.string().min(4) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail('Password too short (min 4 chars)')); return; }
  const id = Number(req.params['id']);
  const user = await queryOne('SELECT id FROM users WHERE id = $1', [id]);
  if (!user) { res.status(404).json(fail('User not found')); return; }
  const hash = bcrypt.hashSync(parsed.data.password, 10);
  await execute('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, id]);
  res.json(ok({ updated: true }));
});

// DELETE /admin/users/:id — delete user + all their data (cascade)
adminRouter.delete('/users/:id', async (req: AuthRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params['id']);
  if (req.user && req.user.id === id) { res.status(400).json(fail('Нельзя удалить себя')); return; }
  const user = await queryOne('SELECT id FROM users WHERE id = $1', [id]);
  if (!user) { res.status(404).json(fail('User not found')); return; }
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    for (const t of ['tasks', 'projects', 'meetings', 'people', 'ideas', 'documents', 'habits', 'goals']) {
      try { await client.query(`DELETE FROM ${t} WHERE user_id = $1`, [id]); } catch {}
    }
    await client.query('DELETE FROM users WHERE id = $1', [id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  res.json(ok({ deleted: true }));
});
