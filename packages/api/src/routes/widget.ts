import { Router, Request, Response } from 'express';
import { queryAll, queryOne, execute } from '../db/db';
import { ok, fail } from '@pis/shared';
import { moscowDateString } from '../utils/time';
import crypto from 'crypto';

export const widgetRouter = Router();

/** Resolve user_id from API key (query param ?key=xxx) */
async function resolveUserByKey(req: Request): Promise<number | null> {
  const key = req.query['key'] as string;
  if (!key) return null;
  const row = await queryOne<{ user_id: number }>(
    "SELECT user_id FROM settings WHERE key = 'widget_api_key' AND value = $1",
    [key]
  );
  return row?.user_id ?? null;
}

// GET /widget/key — generate API key for authenticated user (called from app)
widgetRouter.get('/key', async (req: Request, res: Response) => {
  // This route is behind requireAuth in the main router... but widget is public.
  // We'll check auth header manually here.
  const header = req.headers['authorization'];
  if (!header) { res.status(401).json(fail('Auth required')); return; }

  try {
    const jwt = require('jsonwebtoken');
    const { config } = require('../config');
    const token = header.startsWith('Bearer ') ? header.slice(7) : header;
    const payload = jwt.verify(token, config.jwtSecret) as { id: number };
    const userId = payload.id;

    // Check if key already exists
    const existing = await queryOne<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'widget_api_key' AND user_id = $1",
      [userId]
    );
    if (existing) {
      res.json(ok({ api_key: existing.value }));
      return;
    }

    // Generate new key
    const apiKey = `pis_${crypto.randomBytes(24).toString('hex')}`;
    await execute(
      "INSERT INTO settings (key, value, user_id) VALUES ('widget_api_key', $1, $2)",
      [apiKey, userId]
    );
    res.json(ok({ api_key: apiKey }));
  } catch {
    res.status(401).json(fail('Invalid token'));
  }
});

// POST /widget/key/rotate — revoke old key and issue a fresh one (called from app)
widgetRouter.post('/key/rotate', async (req: Request, res: Response) => {
  const header = req.headers['authorization'];
  if (!header) { res.status(401).json(fail('Auth required')); return; }
  try {
    const jwt = require('jsonwebtoken');
    const { config } = require('../config');
    const token = header.startsWith('Bearer ') ? header.slice(7) : header;
    const payload = jwt.verify(token, config.jwtSecret) as { id: number };
    const userId = payload.id;

    const apiKey = `pis_${crypto.randomBytes(24).toString('hex')}`;
    // Remove any existing key, then insert the fresh one (old key stops working immediately)
    await execute("DELETE FROM settings WHERE key = 'widget_api_key' AND user_id = $1", [userId]);
    await execute(
      "INSERT INTO settings (key, value, user_id) VALUES ('widget_api_key', $1, $2)",
      [apiKey, userId]
    );
    res.json(ok({ api_key: apiKey }));
  } catch {
    res.status(401).json(fail('Invalid token'));
  }
});

// GET /widget/today — tasks for today (requires ?key=xxx)
widgetRouter.get('/today', async (_req: Request, res: Response) => {
  const userId = await resolveUserByKey(_req);
  if (!userId) { res.status(401).json(fail('API key required. Add ?key=YOUR_KEY')); return; }

  const today = moscowDateString();
  const tasks = await queryAll<{ id: number; title: string; status: string; priority: number }>(
    "SELECT id, title, status, priority FROM tasks WHERE (due_date = $1 OR status = 'in_progress') AND status != 'done' AND archived = 0 AND user_id = $2 ORDER BY priority ASC LIMIT 10",
    [today, userId]
  );

  const habits = await queryAll<{ id: number; title: string; icon: string }>(
    "SELECT id, title, icon FROM habits WHERE archived = 0 AND user_id = $1",
    [userId]
  );
  const habitLogs = await queryAll<{ habit_id: number }>(
    "SELECT hl.habit_id FROM habit_logs hl JOIN habits h ON h.id = hl.habit_id WHERE hl.date = $1 AND h.user_id = $2",
    [today, userId]
  );
  const doneHabitIds = new Set(habitLogs.map(l => l.habit_id));

  const overdueRow = await queryOne<{ count: number }>(
    "SELECT COUNT(*) as count FROM tasks WHERE archived = 0 AND status NOT IN ('done','someday') AND due_date < $1 AND user_id = $2",
    [today, userId]
  );
  const overdue = overdueRow?.count ?? 0;

  const meetings = await queryAll(
    "SELECT title, date FROM meetings WHERE date = $1 AND user_id = $2 LIMIT 5",
    [today, userId]
  );

  // Journal focus of the day
  const journal = await queryOne<{ focus: string }>(
    "SELECT focus FROM journal WHERE date = $1 AND user_id = $2",
    [today, userId]
  );
  const focusOfDay = journal?.focus || null;

  // Weekly goal for today
  const weeklyGoal = await queryOne<{ title: string }>(
    "SELECT title FROM tasks WHERE user_id = $1 AND description LIKE '%[🎯 Цель недели]%' AND due_date = $2 AND status != 'done' AND archived = 0 LIMIT 1",
    [userId, today]
  );

  res.json(ok({
    date: today,
    tasks,
    meetings,
    habits: habits.map(h => ({ ...h, done: doneHabitIds.has(h.id) })),
    overdue_count: overdue,
    focus: focusOfDay,
    weekly_goal: weeklyGoal?.title ?? null,
  }));
});

// GET /widget/render — HTML widget for Android web-widget apps (requires ?key=xxx)
widgetRouter.get('/render', async (_req: Request, res: Response) => {
  const userId = await resolveUserByKey(_req);
  if (!userId) {
    res.type('html').send(`<!DOCTYPE html><html><body style="background:#0f172a;color:#ef4444;font-family:sans-serif;padding:12px;margin:0"><p>Invalid API key</p></body></html>`);
    return;
  }

  const today = moscowDateString();
  const tasks = await queryAll<{ title: string; priority: number }>(
    "SELECT title, priority FROM tasks WHERE (due_date = $1 OR status = 'in_progress') AND status != 'done' AND archived = 0 AND user_id = $2 ORDER BY priority ASC LIMIT 6",
    [today, userId]
  );

  const habits = await queryAll<{ id: number; title: string }>(
    "SELECT id, title FROM habits WHERE archived = 0 AND user_id = $1",
    [userId]
  );
  const habitLogs = await queryAll<{ habit_id: number }>(
    "SELECT hl.habit_id FROM habit_logs hl JOIN habits h ON h.id = hl.habit_id WHERE hl.date = $1 AND h.user_id = $2",
    [today, userId]
  );
  const doneHabitIds = new Set(habitLogs.map(l => l.habit_id));
  const habitsDone = habits.filter(h => doneHabitIds.has(h.id)).length;

  const overdueRow = await queryOne<{ count: number }>(
    "SELECT COUNT(*) as count FROM tasks WHERE archived = 0 AND status NOT IN ('done','someday') AND due_date < $1 AND user_id = $2",
    [today, userId]
  );
  const overdue = overdueRow?.count ?? 0;

  const meetings = await queryAll<{ title: string }>(
    "SELECT title FROM meetings WHERE date = $1 AND user_id = $2 LIMIT 3",
    [today, userId]
  );

  const journal = await queryOne<{ focus: string }>(
    "SELECT focus FROM journal WHERE date = $1 AND user_id = $2",
    [today, userId]
  );
  const focus = journal?.focus || null;

  const weeklyGoal = await queryOne<{ title: string }>(
    "SELECT title FROM tasks WHERE user_id = $1 AND description LIKE '%[🎯 Цель недели]%' AND due_date = $2 AND status != 'done' AND archived = 0 LIMIT 1",
    [userId, today]
  );

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let body = '';

  // Focus or weekly goal
  if (focus) {
    body += `<div style="color:#fbbf24;font-size:11px;margin-bottom:3px">\uD83C\uDFAF ${esc(focus)}</div>`;
  } else if (weeklyGoal) {
    body += `<div style="color:#a78bfa;font-size:11px;margin-bottom:3px">\uD83C\uDFAF ${esc(weeklyGoal.title)}</div>`;
  }

  // Overdue
  if (overdue > 0) {
    body += `<div style="color:#ef4444;font-size:11px;margin-bottom:2px">\u26A0 Overdue: ${overdue}</div>`;
  }

  // Meetings
  for (const m of meetings) {
    body += `<div style="color:#93c5fd;font-size:11px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(m.title)}</div>`;
  }
  if (meetings.length > 0) body += `<div style="height:2px"></div>`;

  // Tasks
  for (const t of tasks) {
    body += `<div style="color:#e2e8f0;font-size:11px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">\u2022 ${esc(t.title)}</div>`;
  }

  // Habits
  if (habits.length > 0) {
    body += `<div style="color:#f97316;font-size:10px;margin-top:4px">${habitsDone}/${habits.length} habits</div>`;
  }

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0f172a;font-family:-apple-system,sans-serif;padding:12px;min-height:100vh;overflow:hidden;position:relative}
.circle{position:absolute;border-radius:50%;pointer-events:none}
.c1{width:200px;height:200px;top:-60px;right:-40px;border:1px solid rgba(99,102,241,0.12)}
.c2{width:140px;height:140px;top:-20px;right:-10px;border:1px solid rgba(139,92,246,0.1)}
.c3{width:180px;height:180px;bottom:-50px;left:-50px;background:rgba(99,102,241,0.06);filter:blur(40px)}
</style>
</head><body>
<div class="circle c1"></div><div class="circle c2"></div><div class="circle c3"></div>
<div style="position:relative;z-index:1">
<div style="color:#fff;font-size:14px;font-weight:bold;margin-bottom:4px">CS</div>
${body}
<div style="position:fixed;bottom:12px;right:12px;color:#64748b;font-size:9px;text-align:right">${today}</div>
</div>
</body></html>`;

  res.type('html').send(html);
});

// GET /widget/week — week summary (requires ?key=xxx)
widgetRouter.get('/week', async (_req: Request, res: Response) => {
  const userId = await resolveUserByKey(_req);
  if (!userId) { res.status(401).json(fail('API key required')); return; }

  const today = moscowDateString();
  const weekEnd = new Date();
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndStr = `${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, '0')}-${String(weekEnd.getDate()).padStart(2, '0')}`;

  const tasks = await queryAll(
    "SELECT id, title, status, priority, due_date FROM tasks WHERE due_date BETWEEN $1 AND $2 AND status != 'done' AND archived = 0 AND user_id = $3 ORDER BY due_date, priority ASC LIMIT 20",
    [today, weekEndStr, userId]
  );

  const meetings = await queryAll(
    "SELECT id, title, date FROM meetings WHERE date BETWEEN $1 AND $2 AND user_id = $3 ORDER BY date LIMIT 10",
    [today, weekEndStr, userId]
  );

  res.json(ok({ from: today, to: weekEndStr, tasks, meetings }));
});
