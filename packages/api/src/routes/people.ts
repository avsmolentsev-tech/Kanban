import { Router, Response } from 'express';
import { z } from 'zod';
import { queryAll, queryOne, execute } from '../db/db';
import { ok, fail } from '@pis/shared';
import { searchService } from '../services/search.service';
import type { AuthRequest } from '../middleware/auth';
import { getUserId, userScopeWhere } from '../middleware/user-scope';
import { ObsidianService } from '../services/obsidian.service';
import { config } from '../config';

export const peopleRouter = Router();
const obsidian = new ObsidianService(config.vaultPath);

function syncPersonToVault(personId: number, userId: number | null): void {
  if (userId == null) return;
  void (async () => {
    try {
      const p = await queryOne<{ name: string; company: string | null; role: string | null; phone: string | null; email: string | null; telegram: string | null }>(
        'SELECT name, company, role, phone, email, telegram FROM people WHERE id = $1',
        [personId]
      );
      if (!p) return;
      const projects = await queryAll<{ name: string }>(
        'SELECT p.name FROM projects p JOIN people_projects pp ON p.id = pp.project_id WHERE pp.person_id = $1 ORDER BY p.name',
        [personId]
      );
      const meetings = await queryAll<{ title: string; date: string }>(
        'SELECT m.title, m.date FROM meetings m JOIN meeting_people mp ON m.id = mp.meeting_id WHERE mp.person_id = $1 ORDER BY m.date DESC',
        [personId]
      );
      await obsidian.forUser(userId).writePerson({
        name: p.name,
        company: p.company ?? '',
        role: p.role ?? '',
        phone: p.phone ?? '',
        email: p.email ?? '',
        telegram: p.telegram ?? '',
        projects: projects.map((x) => x.name),
        meetings,
      });
    } catch (err) {
      console.error('[people] vault sync failed:', err instanceof Error ? err.message : err);
    }
  })();
}

const CreateSchema = z.object({
  name: z.string().min(1), company: z.string().optional().default(''), role: z.string().optional().default(''),
  telegram: z.string().optional().default(''), email: z.string().optional().default(''),
  phone: z.string().optional().default(''), notes: z.string().optional().default(''),
  project_id: z.number().nullable().optional().default(null),
  project_ids: z.array(z.number().int()).optional(),
});

async function attachProjects(people: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  if (people.length === 0) return people;
  const ids = people.map(p => p['id'] as number);
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
  const rows = await queryAll<{ person_id: number; id: number; name: string; color: string }>(
    `SELECT pp.person_id, p.id, p.name, p.color FROM people_projects pp JOIN projects p ON p.id = pp.project_id WHERE pp.person_id IN (${placeholders}) ORDER BY p.order_index ASC, p.name ASC`,
    ids
  );

  const byPerson = new Map<number, Array<{ id: number; name: string; color: string }>>();
  for (const row of rows) {
    if (!byPerson.has(row.person_id)) byPerson.set(row.person_id, []);
    byPerson.get(row.person_id)!.push({ id: row.id, name: row.name, color: row.color });
  }

  return people.map(p => {
    const pid = p['id'] as number;
    const projs = byPerson.get(pid) ?? [];
    return { ...p, projects: projs, project_ids: projs.map(pr => pr.id) };
  });
}

peopleRouter.get('/', async (req: AuthRequest, res: Response) => {
  const scope = userScopeWhere(req);
  const people = await queryAll<Record<string, unknown>>(
    `SELECT * FROM people WHERE ${scope.sql} ORDER BY name ASC`,
    scope.params
  );
  res.json(ok(await attachProjects(people)));
});

peopleRouter.post('/', async (req: AuthRequest, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { name, company, role, telegram, email, phone, notes, project_id, project_ids } = parsed.data;

  // Determine effective project_ids: prefer explicit project_ids, fall back to project_id
  const effectiveIds: number[] = project_ids && project_ids.length > 0
    ? project_ids
    : project_id != null ? [project_id] : [];

  const userId = getUserId(req);
  const inserted = await queryOne<{ id: number }>(
    'INSERT INTO people (name, company, role, telegram, email, phone, notes, project_id, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id',
    [name, company, role, telegram, email, phone, notes, effectiveIds[0] ?? null, userId]
  );
  const newId = inserted!.id;

  if (effectiveIds.length > 0) {
    for (const pid of effectiveIds) {
      await execute(
        'INSERT INTO people_projects (person_id, project_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [newId, pid]
      );
    }
  }

  const person = await queryOne<Record<string, unknown>>('SELECT * FROM people WHERE id = $1', [newId]);
  searchService.indexRecord('person', newId, name, notes ?? '');
  syncPersonToVault(newId, userId);
  const [withProjects] = await attachProjects([person!]);
  res.status(201).json(ok(withProjects));
});

const UpdatePersonSchema = z.object({
  name: z.string().min(1).optional(),
  company: z.string().optional(),
  role: z.string().optional(),
  telegram: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  notes: z.string().optional(),
  project_id: z.number().int().nullable().optional(),
  project_ids: z.array(z.number().int()).optional(),
  meet_asap: z.boolean().optional(),
});

peopleRouter.patch('/:id', async (req: AuthRequest, res: Response) => {
  const parsed = UpdatePersonSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const id = Number(req.params['id']);
  const userId = getUserId(req);
  const owner = await queryOne('SELECT id FROM people WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!owner) { res.status(404).json(fail('Person not found')); return; }
  const { project_ids, ...rest } = parsed.data;

  // Update people_projects if project_ids supplied
  if (project_ids !== undefined) {
    await execute('DELETE FROM people_projects WHERE person_id = $1', [id]);
    for (const pid of project_ids) {
      await execute(
        'INSERT INTO people_projects (person_id, project_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [id, pid]
      );
    }
    // Keep project_id in sync with first entry (or null)
    if (!('project_id' in rest)) {
      (rest as Record<string, unknown>)['project_id'] = project_ids[0] ?? null;
    }
  }

  // Convert boolean meet_asap to number for PostgreSQL
  if (typeof (rest as Record<string, unknown>)['meet_asap'] === 'boolean') {
    (rest as Record<string, unknown>)['meet_asap'] = (rest as Record<string, unknown>)['meet_asap'] ? 1 : 0;
  }

  const entries = Object.entries(rest).filter(([, v]) => v !== undefined);

  if (entries.length > 0) {
    const fields = entries.map(([k], i) => `${k} = $${i + 1}`);
    const values = entries.map(([, v]) => v);
    // updated_at goes next, id last
    fields.push(`updated_at = $${entries.length + 1}`);
    await execute(
      `UPDATE people SET ${fields.join(', ')} WHERE id = $${entries.length + 2}`,
      [...values, NOW_ISO(), id]
    );
  }

  const person = await queryOne<Record<string, unknown>>('SELECT * FROM people WHERE id = $1', [id]);
  if (person) searchService.indexRecord('person', person['id'] as number, person['name'] as string, (person['notes'] as string) ?? '');
  syncPersonToVault(id, userId);
  const [withProjects] = await attachProjects([person!]);
  res.json(ok(withProjects));
});

function NOW_ISO(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

peopleRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  const id = Number(req.params['id']);
  const userId = getUserId(req);
  const person = await queryOne('SELECT * FROM people WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!person) { res.status(404).json(fail('Person not found')); return; }
  await execute('DELETE FROM task_people WHERE person_id = $1', [id]);
  await execute('DELETE FROM meeting_people WHERE person_id = $1', [id]);
  await execute('DELETE FROM people_projects WHERE person_id = $1', [id]);
  await execute('DELETE FROM people WHERE id = $1', [id]);
  searchService.removeRecord('person', id);
  res.json(ok({ deleted: true }));
});

peopleRouter.get('/:id/history', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  const person = await queryOne(
    'SELECT * FROM people WHERE id = $1 AND user_id = $2',
    [Number(req.params['id']), userId]
  );
  if (!person) { res.status(404).json(fail('Person not found')); return; }
  const meetings = await queryAll(
    'SELECT m.id, m.title, m.date FROM meetings m JOIN meeting_people mp ON m.id = mp.meeting_id WHERE mp.person_id = $1 ORDER BY m.date DESC',
    [Number(req.params['id'])]
  );
  const agreements = await queryAll(
    'SELECT * FROM agreements WHERE person_id = $1 ORDER BY created_at DESC',
    [Number(req.params['id'])]
  );
  const tasks = await queryAll(
    'SELECT t.id, t.title, t.status FROM tasks t JOIN task_people tp ON t.id = tp.task_id WHERE tp.person_id = $1',
    [Number(req.params['id'])]
  );
  res.json(ok({ person, meetings, agreements, tasks }));
});
