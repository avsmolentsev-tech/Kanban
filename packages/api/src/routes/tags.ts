import { Router, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';
import type { AuthRequest } from '../middleware/auth';
import { getUserId } from '../middleware/user-scope';

export const tagsRouter = Router();

const CreateTagSchema = z.object({
  name: z.string().min(1),
  color: z.string().optional().default('#6366f1'),
});

// GET /tags — list this user's tags
tagsRouter.get('/', (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (userId == null) { res.status(401).json(fail('Authentication required')); return; }
  const tags = getDb().prepare('SELECT * FROM tags WHERE user_id = ? ORDER BY name').all(userId);
  res.json(ok(tags));
});

// POST /tags — create tag owned by this user
tagsRouter.post('/', (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (userId == null) { res.status(401).json(fail('Authentication required')); return; }
  const parsed = CreateTagSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { name, color } = parsed.data;
  const result = getDb().prepare('INSERT INTO tags (name, color, user_id) VALUES (?, ?, ?)').run(name, color, userId);
  const tag = getDb().prepare('SELECT * FROM tags WHERE id = ? AND user_id = ?').get(result.lastInsertRowid, userId);
  res.status(201).json(ok(tag));
});

// DELETE /tags/:id — delete only this user's tag (and its task links)
tagsRouter.delete('/:id', (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (userId == null) { res.status(401).json(fail('Authentication required')); return; }
  const tagId = Number(req.params['id']);
  const tag = getDb().prepare('SELECT id FROM tags WHERE id = ? AND user_id = ?').get(tagId, userId);
  if (!tag) { res.status(404).json(fail('Tag not found')); return; }
  getDb().prepare('DELETE FROM task_tags WHERE tag_id = ?').run(tagId);
  getDb().prepare('DELETE FROM tags WHERE id = ? AND user_id = ?').run(tagId, userId);
  res.json(ok({ deleted: true }));
});

// POST /tasks/:taskId/tags/:tagId — link tag to task
tagsRouter.post('/tasks/:taskId/tags/:tagId', (req: AuthRequest, res: Response) => {
  const taskId = Number(req.params['taskId']);
  const tagId = Number(req.params['tagId']);
  const userId = getUserId(req);
  const task = getDb().prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?').get(taskId, userId);
  if (!task) { res.status(404).json(fail('Task not found')); return; }
  const tag = getDb().prepare('SELECT id FROM tags WHERE id = ? AND user_id = ?').get(tagId, userId);
  if (!tag) { res.status(404).json(fail('Tag not found')); return; }
  try {
    getDb().prepare('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)').run(taskId, tagId);
    res.json(ok({ linked: true }));
  } catch (err) {
    res.status(400).json(fail(err instanceof Error ? err.message : 'Error'));
  }
});

// DELETE /tasks/:taskId/tags/:tagId — unlink tag from task
tagsRouter.delete('/tasks/:taskId/tags/:tagId', (req: AuthRequest, res: Response) => {
  const taskId = Number(req.params['taskId']);
  const tagId = Number(req.params['tagId']);
  const userId = getUserId(req);
  const task = getDb().prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?').get(taskId, userId);
  if (!task) { res.status(404).json(fail('Task not found')); return; }
  getDb().prepare('DELETE FROM task_tags WHERE task_id = ? AND tag_id = ?').run(taskId, tagId);
  res.json(ok({ unlinked: true }));
});
