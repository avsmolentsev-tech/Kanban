import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';

export const tagsRouter = Router();

const CreateTagSchema = z.object({
  name: z.string().min(1),
  color: z.string().optional().default('#6366f1'),
});

// GET /tags — list all tags
tagsRouter.get('/', (_req: Request, res: Response) => {
  const tags = getDb().prepare('SELECT * FROM tags ORDER BY name').all();
  res.json(ok(tags));
});

// POST /tags — create tag
tagsRouter.post('/', (req: Request, res: Response) => {
  const parsed = CreateTagSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { name, color } = parsed.data;
  const result = getDb().prepare('INSERT INTO tags (name, color) VALUES (?, ?)').run(name, color);
  const tag = getDb().prepare('SELECT * FROM tags WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(ok(tag));
});

// DELETE /tags/:id — delete tag
tagsRouter.delete('/:id', (req: Request, res: Response) => {
  const tagId = Number(req.params['id']);
  getDb().prepare('DELETE FROM task_tags WHERE tag_id = ?').run(tagId);
  getDb().prepare('DELETE FROM tags WHERE id = ?').run(tagId);
  res.json(ok({ deleted: true }));
});

// POST /tasks/:taskId/tags/:tagId — link tag to task
tagsRouter.post('/tasks/:taskId/tags/:tagId', (req: Request, res: Response) => {
  const taskId = Number(req.params['taskId']);
  const tagId = Number(req.params['tagId']);
  try {
    getDb().prepare('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)').run(taskId, tagId);
    res.json(ok({ linked: true }));
  } catch (err) {
    res.status(400).json(fail(err instanceof Error ? err.message : 'Error'));
  }
});

// DELETE /tasks/:taskId/tags/:tagId — unlink tag from task
tagsRouter.delete('/tasks/:taskId/tags/:tagId', (req: Request, res: Response) => {
  const taskId = Number(req.params['taskId']);
  const tagId = Number(req.params['tagId']);
  getDb().prepare('DELETE FROM task_tags WHERE task_id = ? AND tag_id = ?').run(taskId, tagId);
  res.json(ok({ unlinked: true }));
});
