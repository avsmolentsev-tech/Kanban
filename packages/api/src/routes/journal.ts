import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';

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

journalRouter.get('/', (_req: Request, res: Response) => {
  const entries = getDb().prepare('SELECT * FROM journal ORDER BY date DESC LIMIT 60').all();
  res.json(ok(entries));
});

journalRouter.post('/', (req: Request, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { date, focus, gratitude, notes, results, mood } = parsed.data;
  // Upsert — if entry for date exists, update it
  const existing = getDb().prepare('SELECT id FROM journal WHERE date = ?').get(date) as { id: number } | undefined;
  if (existing) {
    getDb().prepare('UPDATE journal SET focus = ?, gratitude = ?, notes = ?, results = ?, mood = ? WHERE id = ?').run(focus, gratitude, notes, results, mood, existing.id);
    const updated = getDb().prepare('SELECT * FROM journal WHERE id = ?').get(existing.id);
    res.json(ok(updated));
  } else {
    const result = getDb().prepare('INSERT INTO journal (date, focus, gratitude, notes, results, mood) VALUES (?, ?, ?, ?, ?, ?)').run(date, focus, gratitude, notes, results, mood);
    const entry = getDb().prepare('SELECT * FROM journal WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(ok(entry));
  }
});

journalRouter.patch('/:id', (req: Request, res: Response) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const id = Number(req.params['id']);
  const fields = Object.entries(parsed.data).filter(([, v]) => v !== undefined).map(([k]) => `${k} = ?`);
  const values = Object.values(parsed.data).filter((v) => v !== undefined);
  if (fields.length === 0) { res.status(400).json(fail('No fields')); return; }
  getDb().prepare(`UPDATE journal SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  res.json(ok(getDb().prepare('SELECT * FROM journal WHERE id = ?').get(id)));
});
