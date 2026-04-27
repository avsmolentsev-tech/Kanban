import { Router, Request, Response } from 'express';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';
import { moscowDateString } from '../utils/time';
import crypto from 'crypto';

export const widgetRouter = Router();

/** Resolve user_id from API key (query param ?key=xxx) */
function resolveUserByKey(req: Request): number | null {
  const key = req.query['key'] as string;
  if (!key) return null;
  const db = getDb();
  const row = db.prepare("SELECT user_id FROM settings WHERE key = 'widget_api_key' AND value = ?").get(key) as { user_id: number } | undefined;
  return row?.user_id ?? null;
}

// GET /widget/key — generate API key for authenticated user (called from app)
widgetRouter.get('/key', (req: Request, res: Response) => {
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

    const db = getDb();
    // Check if key already exists
    const existing = db.prepare("SELECT value FROM settings WHERE key = 'widget_api_key' AND user_id = ?").get(userId) as { value: string } | undefined;
    if (existing) {
      res.json(ok({ api_key: existing.value }));
      return;
    }

    // Generate new key
    const apiKey = `pis_${crypto.randomBytes(24).toString('hex')}`;
    db.prepare("INSERT INTO settings (key, value, user_id) VALUES ('widget_api_key', ?, ?)").run(apiKey, userId);
    res.json(ok({ api_key: apiKey }));
  } catch {
    res.status(401).json(fail('Invalid token'));
  }
});

// GET /widget/today — tasks for today (requires ?key=xxx)
widgetRouter.get('/today', (_req: Request, res: Response) => {
  const userId = resolveUserByKey(_req);
  if (!userId) { res.status(401).json(fail('API key required. Add ?key=YOUR_KEY')); return; }

  const db = getDb();
  const today = moscowDateString();
  const tasks = db.prepare(
    "SELECT id, title, status, priority FROM tasks WHERE (due_date = ? OR status = 'in_progress') AND status != 'done' AND archived = 0 AND user_id = ? ORDER BY priority ASC LIMIT 10"
  ).all(today, userId) as Array<{ id: number; title: string; status: string; priority: number }>;

  const habits = db.prepare("SELECT id, title, icon FROM habits WHERE archived = 0 AND user_id = ?").all(userId) as Array<{ id: number; title: string; icon: string }>;
  const habitLogs = db.prepare("SELECT habit_id FROM habit_logs WHERE date = ?").all(today) as Array<{ habit_id: number }>;
  const doneHabitIds = new Set(habitLogs.map(l => l.habit_id));

  const overdue = (db.prepare(
    "SELECT COUNT(*) as count FROM tasks WHERE archived = 0 AND status NOT IN ('done','someday') AND due_date < ? AND user_id = ?"
  ).get(today, userId) as { count: number }).count;

  const meetings = db.prepare(
    "SELECT title, date FROM meetings WHERE date = ? AND user_id = ? LIMIT 5"
  ).all(today, userId);

  // Journal focus of the day
  const journal = db.prepare("SELECT focus FROM journal WHERE date = ? AND user_id = ?").get(today, userId) as { focus: string } | undefined;
  const focusOfDay = journal?.focus || null;

  // Weekly goal for today
  const weeklyGoal = db.prepare(
    "SELECT title FROM tasks WHERE user_id = ? AND description LIKE '%[🎯 Цель недели]%' AND due_date = ? AND status != 'done' AND archived = 0 LIMIT 1"
  ).get(userId, today) as { title: string } | undefined;

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
widgetRouter.get('/render', (_req: Request, res: Response) => {
  const userId = resolveUserByKey(_req);
  if (!userId) {
    res.type('html').send(`<!DOCTYPE html><html><body style="background:#0f172a;color:#ef4444;font-family:sans-serif;padding:12px;margin:0"><p>Invalid API key</p></body></html>`);
    return;
  }

  const db = getDb();
  const today = moscowDateString();
  const tasks = db.prepare(
    "SELECT title, priority FROM tasks WHERE (due_date = ? OR status = 'in_progress') AND status != 'done' AND archived = 0 AND user_id = ? ORDER BY priority ASC LIMIT 6"
  ).all(today, userId) as Array<{ title: string; priority: number }>;

  const habits = db.prepare("SELECT id, title FROM habits WHERE archived = 0 AND user_id = ?").all(userId) as Array<{ id: number; title: string }>;
  const habitLogs = db.prepare("SELECT habit_id FROM habit_logs WHERE date = ?").all(today) as Array<{ habit_id: number }>;
  const doneHabitIds = new Set(habitLogs.map(l => l.habit_id));
  const habitsDone = habits.filter(h => doneHabitIds.has(h.id)).length;

  const overdue = (db.prepare(
    "SELECT COUNT(*) as count FROM tasks WHERE archived = 0 AND status NOT IN ('done','someday') AND due_date < ? AND user_id = ?"
  ).get(today, userId) as { count: number }).count;

  const meetings = db.prepare(
    "SELECT title FROM meetings WHERE date = ? AND user_id = ? LIMIT 3"
  ).all(today, userId) as Array<{ title: string }>;

  const journal = db.prepare("SELECT focus FROM journal WHERE date = ? AND user_id = ?").get(today, userId) as { focus: string } | undefined;
  const focus = journal?.focus || null;

  const weeklyGoal = db.prepare(
    "SELECT title FROM tasks WHERE user_id = ? AND description LIKE '%[🎯 Цель недели]%' AND due_date = ? AND status != 'done' AND archived = 0 LIMIT 1"
  ).get(userId, today) as { title: string } | undefined;

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
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0f172a;font-family:-apple-system,sans-serif;padding:12px;min-height:100vh}</style>
</head><body>
<div style="color:#fff;font-size:14px;font-weight:bold;margin-bottom:4px">CS</div>
${body}
<div style="position:fixed;bottom:12px;right:12px;color:#64748b;font-size:9px;text-align:right">${today}</div>
</body></html>`;

  res.type('html').send(html);
});

// GET /widget/week — week summary (requires ?key=xxx)
widgetRouter.get('/week', (_req: Request, res: Response) => {
  const userId = resolveUserByKey(_req);
  if (!userId) { res.status(401).json(fail('API key required')); return; }

  const db = getDb();
  const today = moscowDateString();
  const weekEnd = new Date();
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndStr = `${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, '0')}-${String(weekEnd.getDate()).padStart(2, '0')}`;

  const tasks = db.prepare(
    "SELECT id, title, status, priority, due_date FROM tasks WHERE due_date BETWEEN ? AND ? AND status != 'done' AND archived = 0 AND user_id = ? ORDER BY due_date, priority ASC LIMIT 20"
  ).all(today, weekEndStr, userId);

  const meetings = db.prepare(
    "SELECT id, title, date FROM meetings WHERE date BETWEEN ? AND ? AND user_id = ? ORDER BY date LIMIT 10"
  ).all(today, weekEndStr, userId);

  res.json(ok({ from: today, to: weekEndStr, tasks, meetings }));
});
