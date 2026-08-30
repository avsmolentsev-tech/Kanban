import { Router, Response } from 'express';
import { z } from 'zod';
import { queryAll, queryOne, execute } from '../db/db';
import { ok, fail } from '@pis/shared';
import type { AuthRequest } from '../middleware/auth';
import { getUserId, userScopeWhere } from '../middleware/user-scope';
import { ObsidianService } from '../services/obsidian.service';
import { config } from '../config';

export const projectsRouter = Router();
const obsidian = new ObsidianService(config.vaultPath);

function syncProjectToVault(projectId: number, userId: number | null): void {
  if (userId == null) return;
  void (async () => {
    try {
      const p = await queryOne<{ name: string; description: string | null; status: string | null; color: string | null }>(
        'SELECT name, description, status, color FROM projects WHERE id = $1',
        [projectId]
      );
      if (!p) return;
      const people = await queryAll<{ name: string }>(
        'SELECT DISTINCT pe.name FROM people pe JOIN people_projects pp ON pe.id = pp.person_id WHERE pp.project_id = $1',
        [projectId]
      );
      const meetings = await queryAll<{ title: string; date: string }>(
        'SELECT title, date FROM meetings WHERE project_id = $1 ORDER BY date DESC',
        [projectId]
      );
      await obsidian.forUser(userId).writeProject({
        name: p.name,
        description: p.description ?? '',
        status: p.status ?? 'active',
        color: p.color ?? '#6366f1',
        people: people.map((x) => x.name),
        meetings,
      });
    } catch (err) {
      console.error('[projects] vault sync failed:', err instanceof Error ? err.message : err);
    }
  })();
}

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

projectsRouter.get('/', async (req: AuthRequest, res: Response) => {
  const scope = userScopeWhere(req);
  const projects = await queryAll(
    `SELECT * FROM projects WHERE archived = 0 AND ${scope.sql} ORDER BY order_index ASC, created_at DESC`,
    scope.params
  );
  res.json(ok(projects));
});

projectsRouter.patch('/reorder', async (req: AuthRequest, res: Response) => {
  const parsed = z.array(z.object({ id: z.number(), order_index: z.number() })).safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  for (const { id, order_index } of parsed.data) {
    await execute('UPDATE projects SET order_index = $1 WHERE id = $2', [order_index, id]);
  }
  const scope = userScopeWhere(req);
  const projects = await queryAll(
    `SELECT * FROM projects WHERE archived = 0 AND ${scope.sql} ORDER BY order_index ASC, created_at DESC`,
    scope.params
  );
  res.json(ok(projects));
});

projectsRouter.post('/', async (req: AuthRequest, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { name, description, status, color } = parsed.data;
  const userId = getUserId(req);
  const inserted = await queryOne<{ id: number }>(
    'INSERT INTO projects (name, description, status, color, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [name, description, status, color, userId]
  );
  const project = await queryOne('SELECT * FROM projects WHERE id = $1', [inserted!.id]);
  syncProjectToVault(inserted!.id, userId);
  res.status(201).json(ok(project));
});

projectsRouter.get('/:id', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  const project = await queryOne(
    'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
    [Number(req.params['id']), userId]
  );
  if (!project) { res.status(404).json(fail('Project not found')); return; }
  const tasks = await queryAll(
    'SELECT * FROM tasks WHERE project_id = $1 AND user_id = $2 AND archived = 0',
    [Number(req.params['id']), userId]
  );
  const meetings = await queryAll(
    'SELECT * FROM meetings WHERE project_id = $1 AND user_id = $2',
    [Number(req.params['id']), userId]
  );
  res.json(ok({ ...project as object, tasks, meetings }));
});

projectsRouter.patch('/:id', async (req: AuthRequest, res: Response) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const userId = getUserId(req);
  const existing = await queryOne(
    'SELECT id FROM projects WHERE id = $1 AND user_id = $2',
    [Number(req.params['id']), userId]
  );
  if (!existing) { res.status(404).json(fail('Project not found')); return; }
  const entries = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) { res.status(400).json(fail('No fields to update')); return; }
  const fields = entries.map(([k], i) => `${k} = $${i + 1}`);
  const values = entries.map(([, v]) => v);
  // updated_at = $N+1, id = $N+2, user_id = $N+3
  fields.push(`updated_at = $${entries.length + 1}`);
  await execute(
    `UPDATE projects SET ${fields.join(', ')} WHERE id = $${entries.length + 2} AND user_id = $${entries.length + 3}`,
    [...values, new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), Number(req.params['id']), userId]
  );
  const updated = await queryOne('SELECT * FROM projects WHERE id = $1', [Number(req.params['id'])]);
  syncProjectToVault(Number(req.params['id']), userId);
  res.json(ok(updated));
});

projectsRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  const id = Number(req.params['id']);
  const userId = getUserId(req);
  const existing = await queryOne('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!existing) { res.status(404).json(fail('Project not found')); return; }
  await execute(
    "UPDATE projects SET archived = 1, updated_at = $1 WHERE id = $2 AND user_id = $3",
    [new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), id, userId]
  );
  res.json(ok({ deleted: true }));
});
