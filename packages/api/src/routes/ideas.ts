import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';
import { searchService } from '../services/search.service';
import { ObsidianService } from '../services/obsidian.service';
import { config } from '../config';
import { moscowDateString } from '../utils/time';
import type { AuthRequest } from '../middleware/auth';
import { getUserId, userScopeWhere } from '../middleware/user-scope';

const obsidian = new ObsidianService(config.vaultPath);

export const ideasRouter = Router();

const IDEA_STATUSES = ['backlog', 'in_obsidian', 'completed', 'garbage'] as const;

const CreateSchema = z.object({
  title: z.string().min(1),
  body: z.string().optional().default(''),
  category: z.enum(['business', 'product', 'personal', 'growth']).optional().default('personal'),
  project_id: z.number().int().nullable().optional(),
  status: z.enum(IDEA_STATUSES).optional().default('backlog'),
});

const UpdateSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  category: z.enum(['business', 'product', 'personal', 'growth']).optional(),
  project_id: z.number().int().nullable().optional(),
  status: z.enum(IDEA_STATUSES).optional(),
});

ideasRouter.get('/', (req: AuthRequest, res: Response) => {
  const scope = userScopeWhere(req);
  let query = `SELECT * FROM ideas WHERE archived = 0 AND ${scope.sql}`;
  const params: unknown[] = [...scope.params];
  if (req.query['category']) { query += ' AND category = ?'; params.push(req.query['category']); }
  if (req.query['project']) { query += ' AND project_id = ?'; params.push(Number(req.query['project'])); }
  if (req.query['status']) { query += ' AND status = ?'; params.push(req.query['status']); }
  query += ' ORDER BY created_at DESC';
  res.json(ok(getDb().prepare(query).all(...params)));
});

ideasRouter.post('/', (req: AuthRequest, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { title, body, category, project_id, status } = parsed.data;
  const userId = getUserId(req);
  const result = getDb().prepare('INSERT INTO ideas (title, body, category, project_id, status, user_id) VALUES (?, ?, ?, ?, ?, ?)').run(title, body, category, project_id ?? null, status, userId);
  searchService.indexRecord('idea', Number(result.lastInsertRowid), title, body ?? '');
  res.status(201).json(ok(getDb().prepare('SELECT * FROM ideas WHERE id = ?').get(result.lastInsertRowid)));
});

ideasRouter.get('/:id', (req: AuthRequest, res: Response) => {
  const idea = getDb().prepare('SELECT * FROM ideas WHERE id = ?').get(Number(req.params['id']));
  if (!idea) { res.status(404).json(fail('Idea not found')); return; }
  res.json(ok(idea));
});

ideasRouter.patch('/:id', async (req: AuthRequest, res: Response) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const id = Number(req.params['id']);
  const before = getDb().prepare('SELECT * FROM ideas WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!before) { res.status(404).json(fail('Idea not found')); return; }

  const fields = Object.entries(parsed.data).filter(([, v]) => v !== undefined).map(([k]) => `${k} = ?`);
  const values = Object.values(parsed.data).filter((v) => v !== undefined);
  if (fields.length === 0) { res.status(400).json(fail('No fields')); return; }
  getDb().prepare(`UPDATE ideas SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);

  const after = getDb().prepare('SELECT * FROM ideas WHERE id = ?').get(id) as Record<string, unknown>;
  searchService.indexRecord('idea', id, after['title'] as string, (after['body'] as string) ?? '');

  // If status changed to in_obsidian → sync to vault
  if (parsed.data.status === 'in_obsidian' && before['status'] !== 'in_obsidian') {
    try {
      const projectName = after['project_id']
        ? (getDb().prepare('SELECT name FROM projects WHERE id = ?').get(after['project_id'] as number) as { name: string } | undefined)?.name
        : undefined;
      const vaultPath = await obsidian.forUser(getUserId(req)).writeIdea({
        title: after['title'] as string,
        body: (after['body'] as string) ?? '',
        category: (after['category'] as string) ?? 'personal',
        project: projectName,
        date: moscowDateString(),
        source: 'kanban',
      });
      getDb().prepare('UPDATE ideas SET vault_path = ? WHERE id = ?').run(vaultPath, id);
      (after as Record<string, unknown>)['vault_path'] = vaultPath;
      console.log(`[ideas] synced idea #${id} to ${vaultPath}`);
    } catch (err) {
      console.warn('[ideas] vault sync failed:', err);
    }
  }

  res.json(ok(after));
});

ideasRouter.delete('/:id', (req: AuthRequest, res: Response) => {
  const id = Number(req.params['id']);
  const idea = getDb().prepare('SELECT vault_path FROM ideas WHERE id = ?').get(id) as { vault_path: string | null } | undefined;
  getDb().prepare('DELETE FROM ideas WHERE id = ?').run(id);
  searchService.removeRecord('idea', id);
  try { if (idea?.vault_path) obsidian.forUser(getUserId(req)).deleteFile(idea.vault_path); } catch {}
  res.json(ok({ deleted: true }));
});
