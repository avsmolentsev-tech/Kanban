import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/db';
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
      const db = getDb();
      const p = db.prepare('SELECT name, description, status, color FROM projects WHERE id = ?').get(projectId) as { name: string; description: string | null; status: string | null; color: string | null } | undefined;
      if (!p) return;
      const people = db.prepare('SELECT DISTINCT pe.name FROM people pe JOIN people_projects pp ON pe.id = pp.person_id WHERE pp.project_id = ?').all(projectId) as Array<{ name: string }>;
      const meetings = db.prepare('SELECT title, date FROM meetings WHERE project_id = ? ORDER BY date DESC').all(projectId) as Array<{ title: string; date: string }>;
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
  syncProjectToVault(Number(result.lastInsertRowid), userId);
  res.status(201).json(ok(project));
});

projectsRouter.get('/:id', (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  const project = getDb().prepare('SELECT * FROM projects WHERE id = ? AND (user_id = ? OR user_id IS NULL)').get(Number(req.params['id']), userId);
  if (!project) { res.status(404).json(fail('Project not found')); return; }
  const tasks = getDb().prepare('SELECT * FROM tasks WHERE project_id = ? AND archived = 0').all(Number(req.params['id']));
  const meetings = getDb().prepare('SELECT * FROM meetings WHERE project_id = ?').all(Number(req.params['id']));
  res.json(ok({ ...project as object, tasks, meetings }));
});

projectsRouter.patch('/:id', (req: AuthRequest, res: Response) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const userId = getUserId(req);
  const existing = getDb().prepare('SELECT id FROM projects WHERE id = ? AND (user_id = ? OR user_id IS NULL)').get(Number(req.params['id']), userId);
  if (!existing) { res.status(404).json(fail('Project not found')); return; }
  const fields = Object.entries(parsed.data).filter(([, v]) => v !== undefined).map(([k]) => `${k} = ?`);
  const values = Object.values(parsed.data).filter((v) => v !== undefined);
  if (fields.length === 0) { res.status(400).json(fail('No fields to update')); return; }
  getDb().prepare(`UPDATE projects SET ${fields.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND (user_id = ? OR user_id IS NULL)`).run(...values, Number(req.params['id']), userId);
  const updated = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(Number(req.params['id']));
  syncProjectToVault(Number(req.params['id']), userId);
  res.json(ok(updated));
});

projectsRouter.delete('/:id', (req: AuthRequest, res: Response) => {
  const id = Number(req.params['id']);
  const userId = getUserId(req);
  const existing = getDb().prepare('SELECT id FROM projects WHERE id = ? AND (user_id = ? OR user_id IS NULL)').get(id, userId);
  if (!existing) { res.status(404).json(fail('Project not found')); return; }
  getDb().prepare("UPDATE projects SET archived = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND (user_id = ? OR user_id IS NULL)").run(id, userId);
  res.json(ok({ deleted: true }));
});
