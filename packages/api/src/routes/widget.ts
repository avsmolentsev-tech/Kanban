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

  res.json(ok({
    date: today,
    tasks,
    meetings,
    habits: habits.map(h => ({ ...h, done: doneHabitIds.has(h.id) })),
    overdue_count: overdue,
  }));
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
