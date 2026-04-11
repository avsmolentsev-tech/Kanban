import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';
import type { AuthRequest } from '../middleware/auth';
import { getUserId, userScopeWhere } from '../middleware/user-scope';

export const projectsRouter = Router();

const CreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().default(''),
  status: z.enum(['active', 'paused', 'completed', 'archived']).optional().default('active'),
  color: z.string().optional().default('#6366f1'),
});

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(['active', 'paused', 'completed', 'archived']).optional(),
  color: z.string().optional(),
  archived: z.boolean().optional(),
});

projectsRouter.get('/', (req: AuthRequest, res: Response) => {
  const scope = userScopeWhere(req);
  const projects = getDb().prepare(`SELECT * FROM projects WHERE archived = 0 AND ${scope.sql} ORDER BY order_index ASC, created_at DESC`).all(...scope.params);
  res.json(ok(projects));
});

projectsRouter.patch('/reorder', (req: AuthRequest, res: Response) => {
  const parsed = z.array(z.object({ id: z.number(), order_index: z.number() })).safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const db = getDb();
  const stmt = db.prepare('UPDATE projects SET order_index = ? WHERE id = ?');
  for (const { id, order_index } of parsed.data) {
    stmt.run(order_index, id);
  }
  const scope = userScopeWhere(req);
  const projects = db.prepare(`SELECT * FROM projects WHERE archived = 0 AND ${scope.sql} ORDER BY order_index ASC, created_at DESC`).all(...scope.params);
  res.json(ok(projects));
});

projectsRouter.post('/', (req: AuthRequest, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { name, description, status, color } = parsed.data;
  const userId = getUserId(req);
  const result = getDb().prepare('INSERT INTO projects (name, description, status, color, user_id) VALUES (?, ?, ?, ?, ?)').run(name, description, status, color, userId);
  const project = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(ok(project));
});

projectsRouter.get('/:id', (req: AuthRequest, res: Response) => {
  const project = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(Number(req.params['id']));
  if (!project) { res.status(404).json(fail('Project not found')); return; }
  const tasks = getDb().prepare('SELECT * FROM tasks WHERE project_id = ? AND archived = 0').all(Number(req.params['id']));
  const meetings = getDb().prepare('SELECT * FROM meetings WHERE project_id = ?').all(Number(req.params['id']));
  res.json(ok({ ...project as object, tasks, meetings }));
});

projectsRouter.patch('/:id', (req: AuthRequest, res: Response) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const fields = Object.entries(parsed.data).filter(([, v]) => v !== undefined).map(([k]) => `${k} = ?`);
  const values = Object.values(parsed.data).filter((v) => v !== undefined);
  if (fields.length === 0) { res.status(400).json(fail('No fields to update')); return; }
  getDb().prepare(`UPDATE projects SET ${fields.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`).run(...values, Number(req.params['id']));
  const updated = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(Number(req.params['id']));
  res.json(ok(updated));
});

projectsRouter.delete('/:id', (req: AuthRequest, res: Response) => {
  const id = Number(req.params['id']);
  getDb().prepare("UPDATE projects SET archived = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").run(id);
  res.json(ok({ deleted: true }));
});
