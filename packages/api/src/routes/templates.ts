import { Router, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';
import type { AuthRequest } from '../middleware/auth';
import { getUserId } from '../middleware/user-scope';

export const templatesRouter = Router();

const CreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(''),
  priority: z.number().int().min(1).max(5).optional().default(3),
  project_id: z.number().int().nullable().optional(),
  tags: z.string().optional().default('[]'),
});

templatesRouter.get('/', (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (userId == null) { res.status(401).json(fail('Authentication required')); return; }
  const rows = getDb().prepare('SELECT * FROM task_templates WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  res.json(ok(rows));
});

templatesRouter.post('/', (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (userId == null) { res.status(401).json(fail('Authentication required')); return; }
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { title, description, priority, project_id, tags } = parsed.data;
  const result = getDb().prepare(
    'INSERT INTO task_templates (user_id, title, description, priority, project_id, tags) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userId, title, description, priority, project_id ?? null, tags);
  res.status(201).json(ok(getDb().prepare('SELECT * FROM task_templates WHERE id = ? AND user_id = ?').get(result.lastInsertRowid, userId)));
});

templatesRouter.delete('/:id', (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (userId == null) { res.status(401).json(fail('Authentication required')); return; }
  const id = Number(req.params['id']);
  const existing = getDb().prepare('SELECT * FROM task_templates WHERE id = ? AND user_id = ?').get(id, userId);
  if (!existing) { res.status(404).json(fail('Template not found')); return; }
  getDb().prepare('DELETE FROM task_templates WHERE id = ? AND user_id = ?').run(id, userId);
  res.json(ok({ deleted: true }));
});

templatesRouter.post('/:id/create-task', (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (userId == null) { res.status(401).json(fail('Authentication required')); return; }
  const id = Number(req.params['id']);
  const template = getDb().prepare('SELECT * FROM task_templates WHERE id = ? AND user_id = ?').get(id, userId) as Record<string, unknown> | undefined;
  if (!template) { res.status(404).json(fail('Template not found')); return; }

  const result = getDb().prepare(
    `INSERT INTO tasks (user_id, title, description, priority, project_id, status) VALUES (?, ?, ?, ?, ?, 'todo')`
  ).run(userId, template['title'], template['description'], template['priority'], template['project_id']);

  const task = getDb().prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(result.lastInsertRowid, userId);
  res.status(201).json(ok(task));
});
