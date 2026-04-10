import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';

export const goalsRouter = Router();

const CreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(''),
  type: z.enum(['goal', 'key_result']).optional().default('goal'),
  parent_id: z.number().int().nullable().optional(),
  project_id: z.number().int().nullable().optional(),
  target_value: z.number().nullable().optional(),
  unit: z.string().optional().default('%'),
  due_date: z.string().nullable().optional(),
});

const UpdateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  type: z.enum(['goal', 'key_result']).optional(),
  parent_id: z.number().int().nullable().optional(),
  project_id: z.number().int().nullable().optional(),
  target_value: z.number().nullable().optional(),
  current_value: z.number().optional(),
  unit: z.string().optional(),
  due_date: z.string().nullable().optional(),
  status: z.enum(['active', 'completed', 'cancelled']).optional(),
});

goalsRouter.get('/', (_req: Request, res: Response) => {
  const goals = getDb()
    .prepare("SELECT * FROM goals WHERE type = 'goal' ORDER BY created_at DESC")
    .all() as Record<string, unknown>[];

  const goalIds = goals.map((g) => g['id'] as number);
  let keyResults: Record<string, unknown>[] = [];
  if (goalIds.length > 0) {
    keyResults = getDb()
      .prepare(
        `SELECT * FROM goals WHERE type = 'key_result' AND parent_id IN (${goalIds.map(() => '?').join(',')}) ORDER BY created_at ASC`
      )
      .all(...goalIds) as Record<string, unknown>[];
  }

  const krByParent = new Map<number, Record<string, unknown>[]>();
  for (const kr of keyResults) {
    const pid = kr['parent_id'] as number;
    if (!krByParent.has(pid)) krByParent.set(pid, []);
    krByParent.get(pid)!.push(kr);
  }

  const enriched = goals.map((g) => ({
    ...g,
    key_results: krByParent.get(g['id'] as number) ?? [],
  }));

  res.json(ok(enriched));
});

goalsRouter.post('/', (req: Request, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(fail(parsed.error.message));
    return;
  }
  const { title, description, type, parent_id, project_id, target_value, unit, due_date } = parsed.data;
  const result = getDb()
    .prepare(
      'INSERT INTO goals (title, description, type, parent_id, project_id, target_value, unit, due_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(title, description, type, parent_id ?? null, project_id ?? null, target_value ?? null, unit, due_date ?? null);
  const goal = getDb().prepare('SELECT * FROM goals WHERE id = ?').get(result.lastInsertRowid as number);
  res.status(201).json(ok(goal));
});

goalsRouter.patch('/:id', (req: Request, res: Response) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(fail(parsed.error.message));
    return;
  }
  const goalId = Number(req.params['id']);
  const entries = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) {
    res.status(400).json(fail('No fields'));
    return;
  }
  const fields = entries.map(([k]) => `${k} = ?`);
  const values = entries.map(([, v]) => v);
  getDb()
    .prepare(`UPDATE goals SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values, goalId);
  const goal = getDb().prepare('SELECT * FROM goals WHERE id = ?').get(goalId);
  res.json(ok(goal));
});

goalsRouter.delete('/:id', (req: Request, res: Response) => {
  const goalId = Number(req.params['id']);
  // Delete key results first
  getDb().prepare('DELETE FROM goals WHERE parent_id = ?').run(goalId);
  getDb().prepare('DELETE FROM goals WHERE id = ?').run(goalId);
  res.json(ok({ deleted: true }));
});
