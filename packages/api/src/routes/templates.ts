import { Router, Response } from 'express';
import { z } from 'zod';
import { queryAll, queryOne, execute } from '../db/db';
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

templatesRouter.get('/', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (userId == null) { res.status(401).json(fail('Authentication required')); return; }
  const rows = await queryAll('SELECT * FROM task_templates WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
  res.json(ok(rows));
});

templatesRouter.post('/', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (userId == null) { res.status(401).json(fail('Authentication required')); return; }
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { title, description, priority, project_id, tags } = parsed.data;
  const inserted = await queryOne<{ id: number }>(
    'INSERT INTO task_templates (user_id, title, description, priority, project_id, tags) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [userId, title, description, priority, project_id ?? null, tags]
  );
  if (!inserted) { res.status(500).json(fail('Insert failed')); return; }
  const template = await queryOne('SELECT * FROM task_templates WHERE id = $1 AND user_id = $2', [inserted.id, userId]);
  res.status(201).json(ok(template));
});

templatesRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (userId == null) { res.status(401).json(fail('Authentication required')); return; }
  const id = Number(req.params['id']);
  const existing = await queryOne('SELECT * FROM task_templates WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!existing) { res.status(404).json(fail('Template not found')); return; }
  await execute('DELETE FROM task_templates WHERE id = $1 AND user_id = $2', [id, userId]);
  res.json(ok({ deleted: true }));
});

templatesRouter.post('/:id/create-task', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (userId == null) { res.status(401).json(fail('Authentication required')); return; }
  const id = Number(req.params['id']);
  const template = await queryOne<Record<string, unknown>>('SELECT * FROM task_templates WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!template) { res.status(404).json(fail('Template not found')); return; }

  const inserted = await queryOne<{ id: number }>(
    `INSERT INTO tasks (user_id, title, description, priority, project_id, status) VALUES ($1, $2, $3, $4, $5, 'todo') RETURNING id`,
    [userId, template['title'], template['description'], template['priority'], template['project_id']]
  );
  if (!inserted) { res.status(500).json(fail('Insert failed')); return; }
  const task = await queryOne('SELECT * FROM tasks WHERE id = $1 AND user_id = $2', [inserted.id, userId]);
  res.status(201).json(ok(task));
});
