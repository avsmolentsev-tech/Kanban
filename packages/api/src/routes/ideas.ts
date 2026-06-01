import { Router, Response } from 'express';
import { z } from 'zod';
import { queryAll, queryOne, execute } from '../db/db';
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

ideasRouter.get('/', async (req: AuthRequest, res: Response) => {
  const scope = userScopeWhere(req);
  let sql = `SELECT * FROM ideas WHERE archived = false AND ${scope.sql}`;
  const params: unknown[] = [...scope.params];
  if (req.query['category']) { sql += ` AND category = $${params.length + 1}`; params.push(req.query['category']); }
  if (req.query['project']) { sql += ` AND project_id = $${params.length + 1}`; params.push(Number(req.query['project'])); }
  if (req.query['status']) { sql += ` AND status = $${params.length + 1}`; params.push(req.query['status']); }
  sql += ' ORDER BY created_at DESC';
  res.json(ok(await queryAll(sql, params)));
});

ideasRouter.post('/', async (req: AuthRequest, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { title, body, category, project_id, status } = parsed.data;
  const userId = getUserId(req);
  const inserted = await queryOne<{ id: number }>(
    'INSERT INTO ideas (title, body, category, project_id, status, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [title, body, category, project_id ?? null, status, userId]
  );
  if (!inserted) { res.status(500).json(fail('Insert failed')); return; }
  searchService.indexRecord('idea', inserted.id, title, body ?? '');
  const idea = await queryOne('SELECT * FROM ideas WHERE id = $1', [inserted.id]);
  res.status(201).json(ok(idea));
});

ideasRouter.get('/:id', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  const idea = await queryOne('SELECT * FROM ideas WHERE id = $1 AND user_id = $2', [Number(req.params['id']), userId]);
  if (!idea) { res.status(404).json(fail('Idea not found')); return; }
  res.json(ok(idea));
});

ideasRouter.patch('/:id', async (req: AuthRequest, res: Response) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const id = Number(req.params['id']);
  const userId = getUserId(req);
  const before = await queryOne<Record<string, unknown>>('SELECT * FROM ideas WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!before) { res.status(404).json(fail('Idea not found')); return; }

  const entries = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) { res.status(400).json(fail('No fields')); return; }
  const fields = entries.map(([k], i) => `${k} = $${i + 1}`);
  const values = entries.map(([, v]) => v);
  await execute(
    `UPDATE ideas SET ${fields.join(', ')} WHERE id = $${values.length + 1} AND user_id = $${values.length + 2}`,
    [...values, id, userId]
  );

  const after = await queryOne<Record<string, unknown>>('SELECT * FROM ideas WHERE id = $1', [id]);
  if (!after) { res.status(404).json(fail('Idea not found after update')); return; }
  searchService.indexRecord('idea', id, after['title'] as string, (after['body'] as string) ?? '');

  // If status changed to in_obsidian → sync to vault
  if (parsed.data.status === 'in_obsidian' && before['status'] !== 'in_obsidian') {
    try {
      const projectRow = after['project_id']
        ? await queryOne<{ name: string }>('SELECT name FROM projects WHERE id = $1', [after['project_id'] as number])
        : undefined;
      const projectName = projectRow?.name;
      const company = (after['company'] as string | null) ?? undefined;
      const tagsRaw = after['tags'] as string | null;
      const tags = tagsRaw ? JSON.parse(tagsRaw) as string[] : undefined;
      const source = (after['source'] as string | null) ?? 'kanban';
      const vaultPath = await obsidian.forUser(getUserId(req)).writeIdea({
        title: after['title'] as string,
        body: (after['body'] as string) ?? '',
        category: (after['category'] as string) ?? 'personal',
        project: projectName,
        company,
        date: moscowDateString(),
        source,
        tags,
      });
      await execute('UPDATE ideas SET vault_path = $1 WHERE id = $2', [vaultPath, id]);
      (after as Record<string, unknown>)['vault_path'] = vaultPath;
      console.log(`[ideas] synced idea #${id} to ${vaultPath}`);
    } catch (err) {
      console.warn('[ideas] vault sync failed:', err);
    }
  }

  res.json(ok(after));
});

ideasRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  const id = Number(req.params['id']);
  const userId = getUserId(req);
  const idea = await queryOne<{ vault_path: string | null }>('SELECT vault_path FROM ideas WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!idea) { res.status(404).json(fail('Idea not found')); return; }
  await execute('DELETE FROM ideas WHERE id = $1', [id]);
  searchService.removeRecord('idea', id);
  try { if (idea?.vault_path) obsidian.forUser(getUserId(req)).deleteFile(idea.vault_path); } catch {}
  res.json(ok({ deleted: true }));
});
