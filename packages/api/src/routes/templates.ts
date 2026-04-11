import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';

export const templatesRouter = Router();

const CreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(''),
  priority: z.number().int().min(1).max(5).optional().default(3),
  project_id: z.number().int().nullable().optional(),
  tags: z.string().optional().default('[]'),
});

// GET /templates — list all templates
templatesRouter.get('/', (_req: Request, res: Response) => {
  const rows = getDb().prepare('SELECT * FROM task_templates ORDER BY created_at DESC').all();
  res.json(ok(rows));
});

// POST /templates — create template
templatesRouter.post('/', (req: Request, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { title, description, priority, project_id, tags } = parsed.data;
  const result = getDb().prepare(
    'INSERT INTO task_templates (title, description, priority, project_id, tags) VALUES (?, ?, ?, ?, ?)'
  ).run(title, description, priority, project_id ?? null, tags);
  res.status(201).json(ok(getDb().prepare('SELECT * FROM task_templates WHERE id = ?').get(result.lastInsertRowid)));
});

// DELETE /templates/:id — delete template
templatesRouter.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  const existing = getDb().prepare('SELECT * FROM task_templates WHERE id = ?').get(id);
  if (!existing) { res.status(404).json(fail('Template not found')); return; }
  getDb().prepare('DELETE FROM task_templates WHERE id = ?').run(id);
  res.json(ok({ deleted: true }));
});

// POST /templates/:id/create-task — create a real task from template
templatesRouter.post('/:id/create-task', (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  const template = getDb().prepare('SELECT * FROM task_templates WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!template) { res.status(404).json(fail('Template not found')); return; }

  const result = getDb().prepare(
    `INSERT INTO tasks (title, description, priority, project_id, status) VALUES (?, ?, ?, ?, 'todo')`
  ).run(template['title'], template['description'], template['priority'], template['project_id']);

  const task = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(ok(task));
});
