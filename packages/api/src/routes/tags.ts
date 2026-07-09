import { Router, Response } from 'express';
import { z } from 'zod';
import { queryAll, queryOne, execute } from '../db/db';
import { ok, fail } from '@pis/shared';
import type { AuthRequest } from '../middleware/auth';
import { getUserId } from '../middleware/user-scope';

export const tagsRouter = Router();

const CreateTagSchema = z.object({
  name: z.string().min(1),
  color: z.string().optional().default('#6366f1'),
});

// GET /tags — list current user's tags
tagsRouter.get('/', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  const tags = await queryAll('SELECT * FROM tags WHERE user_id = $1 ORDER BY name', [userId]);
  res.json(ok(tags));
});

// POST /tags — create tag owned by current user
tagsRouter.post('/', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  const parsed = CreateTagSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { name, color } = parsed.data;
  const inserted = await queryOne<{ id: number }>(
    'INSERT INTO tags (name, color, user_id) VALUES ($1, $2, $3) RETURNING id',
    [name, color, userId]
  );
  if (!inserted) { res.status(500).json(fail('Insert failed')); return; }
  const tag = await queryOne('SELECT * FROM tags WHERE id = $1 AND user_id = $2', [inserted.id, userId]);
  res.status(201).json(ok(tag));
});

// DELETE /tags/:id — delete a tag owned by current user
tagsRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  const tagId = Number(req.params['id']);
  // Verify ownership before touching anything
  const owned = await queryOne('SELECT id FROM tags WHERE id = $1 AND user_id = $2', [tagId, userId]);
  if (!owned) { res.status(404).json(fail('Tag not found')); return; }
  await execute('DELETE FROM task_tags WHERE tag_id = $1', [tagId]);
  await execute('DELETE FROM tags WHERE id = $1 AND user_id = $2', [tagId, userId]);
  res.json(ok({ deleted: true }));
});

// POST /tasks/:taskId/tags/:tagId — link tag to task
tagsRouter.post('/tasks/:taskId/tags/:tagId', async (req: AuthRequest, res: Response) => {
  const taskId = Number(req.params['taskId']);
  const tagId = Number(req.params['tagId']);
  const userId = getUserId(req);
  const task = await queryOne('SELECT id FROM tasks WHERE id = $1 AND user_id = $2', [taskId, userId]);
  if (!task) { res.status(404).json(fail('Task not found')); return; }
  try {
    await execute(
      'INSERT INTO task_tags (task_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [taskId, tagId]
    );
    res.json(ok({ linked: true }));
  } catch (err) {
    res.status(400).json(fail(err instanceof Error ? err.message : 'Error'));
  }
});

// DELETE /tasks/:taskId/tags/:tagId — unlink tag from task
tagsRouter.delete('/tasks/:taskId/tags/:tagId', async (req: AuthRequest, res: Response) => {
  const taskId = Number(req.params['taskId']);
  const tagId = Number(req.params['tagId']);
  const userId = getUserId(req);
  const task = await queryOne('SELECT id FROM tasks WHERE id = $1 AND user_id = $2', [taskId, userId]);
  if (!task) { res.status(404).json(fail('Task not found')); return; }
  await execute('DELETE FROM task_tags WHERE task_id = $1 AND tag_id = $2', [taskId, tagId]);
  res.json(ok({ unlinked: true }));
});
