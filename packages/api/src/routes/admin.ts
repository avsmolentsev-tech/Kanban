import { Router, Response } from 'express';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';
import type { AuthRequest } from '../middleware/auth';

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
        SELECT COUNT(*) as cnt FROM usage_logs WHERE (user_id = ? OR user_id IS NULL) AND type = 'transcription'
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
