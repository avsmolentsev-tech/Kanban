import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';

export const ideasRouter = Router();

const CreateSchema = z.object({
  title: z.string().min(1),
  body: z.string().optional().default(''),
  category: z.enum(['business', 'product', 'personal', 'growth']).optional().default('personal'),
  project_id: z.number().int().nullable().optional(),
});

ideasRouter.get('/', (req: Request, res: Response) => {
  let query = 'SELECT * FROM ideas WHERE 1=1';
  const params: unknown[] = [];
  if (req.query['category']) { query += ' AND category = ?'; params.push(req.query['category']); }
  if (req.query['project']) { query += ' AND project_id = ?'; params.push(Number(req.query['project'])); }
  query += ' ORDER BY created_at DESC';
  res.json(ok(getDb().prepare(query).all(...params)));
});

ideasRouter.post('/', (req: Request, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { title, body, category, project_id } = parsed.data;
  const result = getDb().prepare('INSERT INTO ideas (title, body, category, project_id) VALUES (?, ?, ?, ?)').run(title, body, category, project_id ?? null);
  res.status(201).json(ok(getDb().prepare('SELECT * FROM ideas WHERE id = ?').get(result.lastInsertRowid)));
});

ideasRouter.get('/:id', (req: Request, res: Response) => {
  const idea = getDb().prepare('SELECT * FROM ideas WHERE id = ?').get(Number(req.params['id']));
  if (!idea) { res.status(404).json(fail('Idea not found')); return; }
  res.json(ok(idea));
});

ideasRouter.patch('/:id', (req: Request, res: Response) => {
  const UpdateSchema = z.object({
    title: z.string().min(1).optional(),
    body: z.string().optional(),
    category: z.enum(['business', 'product', 'personal', 'growth']).optional(),
    project_id: z.number().int().nullable().optional(),
  });
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const fields = Object.entries(parsed.data).filter(([, v]) => v !== undefined).map(([k]) => `${k} = ?`);
  const values = Object.values(parsed.data).filter((v) => v !== undefined);
  if (fields.length === 0) { res.status(400).json(fail('No fields')); return; }
  getDb().prepare(`UPDATE ideas SET ${fields.join(', ')} WHERE id = ?`).run(...values, Number(req.params['id']));
  res.json(ok(getDb().prepare('SELECT * FROM ideas WHERE id = ?').get(Number(req.params['id']))));
});

ideasRouter.delete('/:id', (req: Request, res: Response) => {
  getDb().prepare('DELETE FROM ideas WHERE id = ?').run(Number(req.params['id']));
  res.json(ok({ deleted: true }));
});
