import { Router, Request, Response } from 'express';
import { getDb } from '../db/db';
import { ok } from '@pis/shared';

export const widgetRouter = Router();

// GET /widget/today — compact data for iPhone widget
widgetRouter.get('/today', (_req: Request, res: Response) => {
  const db = getDb();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const tasks = db.prepare(
    "SELECT title, status, priority, due_date FROM tasks WHERE archived = 0 AND status NOT IN ('done','someday') AND (due_date <= ? OR status = 'in_progress') ORDER BY priority DESC LIMIT 8"
  ).all(today);

  const meetings = db.prepare(
    "SELECT title, date FROM meetings WHERE date = ? LIMIT 5"
  ).all(today);

  const habits = db.prepare("SELECT id, title, icon FROM habits WHERE archived = 0").all() as Array<{id: number; title: string; icon: string}>;
  const logs = db.prepare("SELECT habit_id FROM habit_logs WHERE date = ?").all(today) as Array<{habit_id: number}>;
  const doneHabits = new Set(logs.map(l => l.habit_id));

  const overdue = db.prepare(
    "SELECT COUNT(*) as count FROM tasks WHERE archived = 0 AND status NOT IN ('done','someday') AND due_date < ?"
  ).get(today) as {count: number};

  res.json(ok({
    date: today,
    tasks,
    meetings,
    habits: habits.map(h => ({ ...h, done: doneHabits.has(h.id) })),
    overdue_count: overdue.count,
  }));
});

// GET /widget/week — week overview
widgetRouter.get('/week', (_req: Request, res: Response) => {
  const db = getDb();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const weekEnd = new Date(now);
  weekEnd.setDate(now.getDate() + 7);
  const weekEndStr = `${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, '0')}-${String(weekEnd.getDate()).padStart(2, '0')}`;

  const tasksDue = db.prepare(
    "SELECT title, due_date, priority FROM tasks WHERE archived = 0 AND status NOT IN ('done','someday') AND due_date >= ? AND due_date <= ? ORDER BY due_date, priority DESC LIMIT 15"
  ).all(today, weekEndStr);

  const meetingsWeek = db.prepare(
    "SELECT title, date FROM meetings WHERE date >= ? AND date <= ? ORDER BY date LIMIT 10"
  ).all(today, weekEndStr);

  res.json(ok({ tasks: tasksDue, meetings: meetingsWeek }));
});
