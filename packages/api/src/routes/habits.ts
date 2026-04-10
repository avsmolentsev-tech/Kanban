import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';

export const habitsRouter = Router();

const CreateSchema = z.object({
  title: z.string().min(1),
  icon: z.string().optional().default('✅'),
  color: z.string().optional().default('#6366f1'),
  frequency: z.enum(['daily', 'weekly']).optional().default('daily'),
});

const UpdateSchema = z.object({
  title: z.string().min(1).optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  frequency: z.enum(['daily', 'weekly']).optional(),
});

const LogSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function calculateStreak(habitId: number): number {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT date FROM habit_logs WHERE habit_id = ? AND completed = 1 ORDER BY date DESC`
    )
    .all(habitId) as { date: string }[];

  if (rows.length === 0) return 0;

  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Start from today and go backwards
  const checkDate = new Date(today);

  for (let i = 0; i < 400; i++) {
    const dateStr = checkDate.toISOString().slice(0, 10);
    const found = rows.find((r) => r.date === dateStr);
    if (found) {
      streak++;
    } else if (i > 0) {
      // Allow today to be missing (not yet logged), but break on any other gap
      break;
    }
    checkDate.setDate(checkDate.getDate() - 1);
  }

  return streak;
}

// GET /habits — list all active habits with streak
habitsRouter.get('/', (_req: Request, res: Response) => {
  const habits = getDb()
    .prepare('SELECT * FROM habits WHERE archived = 0 ORDER BY created_at ASC')
    .all() as Array<Record<string, unknown>>;

  const result = habits.map((h) => ({
    ...h,
    streak: calculateStreak(h.id as number),
  }));

  res.json(ok(result));
});

// GET /habits/stats — completion stats for current month
habitsRouter.get('/stats', (_req: Request, res: Response) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const monthPrefix = `${year}-${month}`;

  const habits = getDb()
    .prepare('SELECT id, title, icon, color FROM habits WHERE archived = 0')
    .all() as Array<{ id: number; title: string; icon: string; color: string }>;

  const stats = habits.map((h) => {
    const logs = getDb()
      .prepare(
        `SELECT date FROM habit_logs WHERE habit_id = ? AND completed = 1 AND date LIKE ?`
      )
      .all(h.id, `${monthPrefix}%`) as { date: string }[];

    const daysInMonth = new Date(year, now.getMonth() + 1, 0).getDate();
    const daysPassed = Math.min(now.getDate(), daysInMonth);

    return {
      ...h,
      completedDays: logs.length,
      totalDays: daysPassed,
      rate: daysPassed > 0 ? Math.round((logs.length / daysPassed) * 100) : 0,
      dates: logs.map((l) => l.date),
    };
  });

  res.json(ok(stats));
});

// POST /habits — create habit
habitsRouter.post('/', (req: Request, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { title, icon, color, frequency } = parsed.data;
  const result = getDb()
    .prepare('INSERT INTO habits (title, icon, color, frequency) VALUES (?, ?, ?, ?)')
    .run(title, icon, color, frequency);
  const habit = getDb().prepare('SELECT * FROM habits WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(ok({ ...(habit as Record<string, unknown>), streak: 0 }));
});

// PATCH /habits/:id — update habit
habitsRouter.patch('/:id', (req: Request, res: Response) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const id = Number(req.params['id']);
  const existing = getDb().prepare('SELECT * FROM habits WHERE id = ?').get(id);
  if (!existing) { res.status(404).json(fail('Habit not found')); return; }

  const fields = Object.entries(parsed.data).filter(([, v]) => v !== undefined).map(([k]) => `${k} = ?`);
  const values = Object.values(parsed.data).filter((v) => v !== undefined);
  if (fields.length === 0) { res.status(400).json(fail('No fields')); return; }
  getDb().prepare(`UPDATE habits SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);

  const updated = getDb().prepare('SELECT * FROM habits WHERE id = ?').get(id) as Record<string, unknown>;
  res.json(ok({ ...updated, streak: calculateStreak(id) }));
});

// DELETE /habits/:id — archive habit
habitsRouter.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  getDb().prepare('UPDATE habits SET archived = 1 WHERE id = ?').run(id);
  res.json(ok({ archived: true }));
});

// POST /habits/:id/log — toggle log for date
habitsRouter.post('/:id/log', (req: Request, res: Response) => {
  const parsed = LogSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const id = Number(req.params['id']);
  const { date } = parsed.data;

  const existing = getDb()
    .prepare('SELECT * FROM habit_logs WHERE habit_id = ? AND date = ?')
    .get(id, date);

  if (existing) {
    getDb().prepare('DELETE FROM habit_logs WHERE habit_id = ? AND date = ?').run(id, date);
    res.json(ok({ logged: false, date }));
  } else {
    getDb()
      .prepare('INSERT INTO habit_logs (habit_id, date, completed) VALUES (?, ?, 1)')
      .run(id, date);
    res.json(ok({ logged: true, date }));
  }
});
