import { Router, Response } from 'express';
import { z } from 'zod';
import { queryAll, queryOne, execute } from '../db/db';
import { ok, fail } from '@pis/shared';
import type { AuthRequest } from '../middleware/auth';
import { getUserId, userScopeWhere } from '../middleware/user-scope';

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
  frequency: z.string().optional(),
  remind_time: z.string().nullable().optional(),
});

const LogSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

async function calculateStreak(habitId: number): Promise<number> {
  const rows = await queryAll<{ date: string }>(
    `SELECT date FROM habit_logs WHERE habit_id = $1 AND completed = 1 ORDER BY date DESC`,
    [habitId]
  );

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
habitsRouter.get('/', async (req: AuthRequest, res: Response) => {
  const scope = userScopeWhere(req);
  const habits = await queryAll<Record<string, unknown>>(
    `SELECT * FROM habits WHERE archived = 0 AND ${scope.sql} ORDER BY created_at ASC`,
    scope.params
  );

  const result = await Promise.all(
    habits.map(async (h) => ({
      ...h,
      streak: await calculateStreak(h.id as number),
    }))
  );

  res.json(ok(result));
});

// GET /habits/stats — completion stats for current month
habitsRouter.get('/stats', async (req: AuthRequest, res: Response) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const monthPrefix = `${year}-${month}`;

  const scope = userScopeWhere(req);
  const habits = await queryAll<{ id: number; title: string; icon: string; color: string }>(
    `SELECT id, title, icon, color FROM habits WHERE archived = 0 AND ${scope.sql}`,
    scope.params
  );

  const stats = await Promise.all(
    habits.map(async (h) => {
      const logs = await queryAll<{ date: string }>(
        `SELECT date FROM habit_logs WHERE habit_id = $1 AND completed = 1 AND date LIKE $2`,
        [h.id, `${monthPrefix}%`]
      );

      const daysInMonth = new Date(year, now.getMonth() + 1, 0).getDate();
      const daysPassed = Math.min(now.getDate(), daysInMonth);

      return {
        ...h,
        completedDays: logs.length,
        totalDays: daysPassed,
        rate: daysPassed > 0 ? Math.round((logs.length / daysPassed) * 100) : 0,
        dates: logs.map((l) => l.date),
      };
    })
  );

  res.json(ok(stats));
});

// POST /habits — create habit
habitsRouter.post('/', async (req: AuthRequest, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { title, icon, color, frequency } = parsed.data;
  const userId = getUserId(req);
  const inserted = await queryOne<{ id: number }>(
    'INSERT INTO habits (title, icon, color, frequency, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [title, icon, color, frequency, userId]
  );
  const habit = await queryOne('SELECT * FROM habits WHERE id = $1', [inserted!.id]);
  res.status(201).json(ok({ ...(habit as Record<string, unknown>), streak: 0 }));
});

// PATCH /habits/:id — update habit
habitsRouter.patch('/:id', async (req: AuthRequest, res: Response) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const id = Number(req.params['id']);
  const userId = getUserId(req);
  const existing = await queryOne('SELECT * FROM habits WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!existing) { res.status(404).json(fail('Habit not found')); return; }

  const entries = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) { res.status(400).json(fail('No fields')); return; }
  const fields = entries.map(([k], i) => `${k} = $${i + 1}`);
  const values = entries.map(([, v]) => v);
  // id goes at the end as the last param
  await execute(
    `UPDATE habits SET ${fields.join(', ')} WHERE id = $${entries.length + 1}`,
    [...values, id]
  );

  const updated = await queryOne<Record<string, unknown>>('SELECT * FROM habits WHERE id = $1', [id]);
  res.json(ok({ ...updated!, streak: await calculateStreak(id) }));
});

// DELETE /habits/:id — archive habit
habitsRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  const id = Number(req.params['id']);
  const userId = getUserId(req);
  const existing = await queryOne('SELECT id FROM habits WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!existing) { res.status(404).json(fail('Habit not found')); return; }
  await execute('UPDATE habits SET archived = 1 WHERE id = $1 AND user_id = $2', [id, userId]);
  res.json(ok({ archived: true }));
});

// POST /habits/:id/log — toggle log for date
habitsRouter.post('/:id/log', async (req: AuthRequest, res: Response) => {
  const parsed = LogSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const id = Number(req.params['id']);
  const { date } = parsed.data;

  const habit = await queryOne('SELECT id FROM habits WHERE id = $1 AND user_id = $2', [id, getUserId(req)]);
  if (!habit) { res.status(404).json(fail('Habit not found')); return; }

  const existing = await queryOne(
    'SELECT * FROM habit_logs WHERE habit_id = $1 AND date = $2',
    [id, date]
  );

  if (existing) {
    await execute('DELETE FROM habit_logs WHERE habit_id = $1 AND date = $2', [id, date]);
    res.json(ok({ logged: false, date }));
  } else {
    await execute(
      'INSERT INTO habit_logs (habit_id, date, completed) VALUES ($1, $2, 1)',
      [id, date]
    );
    res.json(ok({ logged: true, date }));
  }
});
