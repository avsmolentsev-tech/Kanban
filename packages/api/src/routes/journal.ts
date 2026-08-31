import { Router, Response } from 'express';
import { z } from 'zod';
import { queryAll, queryOne, execute } from '../db/db';
import { ok, fail } from '@pis/shared';
import type { AuthRequest } from '../middleware/auth';
import { getUserId, userScopeWhere } from '../middleware/user-scope';

export const journalRouter = Router();

const CreateSchema = z.object({
  date: z.string(),
  focus: z.string().optional().default(''),
  gratitude: z.string().optional().default(''),
  notes: z.string().optional().default(''),
  results: z.string().optional().default(''),
  mood: z.number().int().min(1).max(5).optional().default(3),
});

const UpdateSchema = z.object({
  focus: z.string().optional(),
  gratitude: z.string().optional(),
  notes: z.string().optional(),
  results: z.string().optional(),
  mood: z.number().int().min(1).max(5).optional(),
});

journalRouter.get('/', async (req: AuthRequest, res: Response) => {
  const scope = userScopeWhere(req);
  const entries = await queryAll(
    `SELECT * FROM journal WHERE ${scope.sql} ORDER BY date DESC LIMIT 60`,
    scope.params
  );
  res.json(ok(entries));
});

journalRouter.post('/', async (req: AuthRequest, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { date, focus, gratitude, notes, results, mood } = parsed.data;
  const userId = getUserId(req);
  // Upsert — if entry for date exists for this user, update it
  const existing = await queryOne<{ id: number }>(
    'SELECT id FROM journal WHERE date = $1 AND user_id = $2',
    [date, userId]
  );
  if (existing) {
    await execute(
      'UPDATE journal SET focus = $1, gratitude = $2, notes = $3, results = $4, mood = $5 WHERE id = $6',
      [focus, gratitude, notes, results, mood, existing.id]
    );
    const updated = await queryOne('SELECT * FROM journal WHERE id = $1', [existing.id]);
    res.json(ok(updated));
  } else {
    const inserted = await queryOne<{ id: number }>(
      'INSERT INTO journal (date, focus, gratitude, notes, results, mood, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
      [date, focus, gratitude, notes, results, mood, userId]
    );
    if (!inserted) { res.status(500).json(fail('Insert failed')); return; }
    const entry = await queryOne('SELECT * FROM journal WHERE id = $1', [inserted.id]);
    res.status(201).json(ok(entry));
  }
});

journalRouter.patch('/:id', async (req: AuthRequest, res: Response) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const id = Number(req.params['id']);
  const userId = getUserId(req);
  const existing = await queryOne('SELECT id FROM journal WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!existing) { res.status(404).json(fail('Journal entry not found')); return; }
  const entries = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) { res.status(400).json(fail('No fields')); return; }
  const fields = entries.map(([k], i) => `${k} = $${i + 1}`);
  const values = entries.map(([, v]) => v);
  await execute(
    `UPDATE journal SET ${fields.join(', ')} WHERE id = $${values.length + 1} AND user_id = $${values.length + 2}`,
    [...values, id, userId]
  );
  res.json(ok(await queryOne('SELECT * FROM journal WHERE id = $1', [id])));
});
