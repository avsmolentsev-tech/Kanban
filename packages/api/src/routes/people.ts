import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/db';
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
      const db = getDb();
      const p = db.prepare('SELECT name, company, role FROM people WHERE id = ?').get(personId) as { name: string; company: string | null; role: string | null } | undefined;
      if (!p) return;
      const projects = db.prepare('SELECT p.name FROM projects p JOIN people_projects pp ON p.id = pp.project_id WHERE pp.person_id = ? ORDER BY p.name').all(personId) as Array<{ name: string }>;
      const meetings = db.prepare('SELECT m.title, m.date FROM meetings m JOIN meeting_people mp ON m.id = mp.meeting_id WHERE mp.person_id = ? ORDER BY m.date DESC').all(personId) as Array<{ title: string; date: string }>;
      await obsidian.forUser(userId).writePerson({
        name: p.name,
        company: p.company ?? '',
        role: p.role ?? '',
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

function attachProjects(people: Record<string, unknown>[]): Record<string, unknown>[] {
  if (people.length === 0) return people;
  const ids = people.map(p => p['id'] as number);
  const rows = getDb().prepare(
    `SELECT pp.person_id, p.id, p.name, p.color FROM people_projects pp JOIN projects p ON p.id = pp.project_id WHERE pp.person_id IN (${ids.map(() => '?').join(',')}) ORDER BY p.order_index ASC, p.name ASC`
  ).all(...ids) as Array<{ person_id: number; id: number; name: string; color: string }>;

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

peopleRouter.get('/', (req: AuthRequest, res: Response) => {
  const scope = userScopeWhere(req);
  const people = getDb().prepare(`SELECT * FROM people WHERE ${scope.sql} ORDER BY name ASC`).all(...scope.params) as Record<string, unknown>[];
  res.json(ok(attachProjects(people)));
});

peopleRouter.post('/', (req: AuthRequest, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { name, company, role, telegram, email, phone, notes, project_id, project_ids } = parsed.data;

  // Determine effective project_ids: prefer explicit project_ids, fall back to project_id
  const effectiveIds: number[] = project_ids && project_ids.length > 0
    ? project_ids
    : project_id != null ? [project_id] : [];

  const userId = getUserId(req);
  const result = getDb().prepare('INSERT INTO people (name, company, role, telegram, email, phone, notes, project_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(name, company, role, telegram, email, phone, notes, effectiveIds[0] ?? null, userId);
  const newId = result.lastInsertRowid as number;

  if (effectiveIds.length > 0) {
    const insertPP = getDb().prepare('INSERT OR IGNORE INTO people_projects (person_id, project_id) VALUES (?, ?)');
    for (const pid of effectiveIds) insertPP.run(newId, pid);
  }

  const person = getDb().prepare('SELECT * FROM people WHERE id = ?').get(newId) as Record<string, unknown>;
  searchService.indexRecord('person', newId, name, notes ?? '');
  syncPersonToVault(newId, userId);
  const [withProjects] = attachProjects([person]);
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

peopleRouter.patch('/:id', (req: AuthRequest, res: Response) => {
  const parsed = UpdatePersonSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const id = Number(req.params['id']);
  const userId = getUserId(req);
  const owner = getDb().prepare('SELECT id FROM people WHERE id = ? AND user_id = ?').get(id, userId);
  if (!owner) { res.status(404).json(fail('Person not found')); return; }
  const { project_ids, ...rest } = parsed.data;

  // Update people_projects if project_ids supplied
  if (project_ids !== undefined) {
    getDb().prepare('DELETE FROM people_projects WHERE person_id = ?').run(id);
    const insertPP = getDb().prepare('INSERT OR IGNORE INTO people_projects (person_id, project_id) VALUES (?, ?)');
    for (const pid of project_ids) insertPP.run(id, pid);
    // Keep project_id in sync with first entry (or null)
    if (!('project_id' in rest)) {
      (rest as Record<string, unknown>)['project_id'] = project_ids[0] ?? null;
    }
  }

  // Convert boolean meet_asap to number for SQLite
  if (typeof (rest as Record<string, unknown>)['meet_asap'] === 'boolean') {
    (rest as Record<string, unknown>)['meet_asap'] = (rest as Record<string, unknown>)['meet_asap'] ? 1 : 0;
  }

  const fields = Object.entries(rest).filter(([, v]) => v !== undefined).map(([k]) => `${k} = ?`);
  const values = Object.entries(rest).filter(([, v]) => v !== undefined).map(([, v]) => v);

  if (fields.length > 0) {
    getDb().prepare(`UPDATE people SET ${fields.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`).run(...values, id);
  }

  const person = getDb().prepare('SELECT * FROM people WHERE id = ?').get(id) as Record<string, unknown>;
  if (person) searchService.indexRecord('person', person['id'] as number, person['name'] as string, (person['notes'] as string) ?? '');
  syncPersonToVault(id, userId);
  const [withProjects] = attachProjects([person]);
  res.json(ok(withProjects));
});

peopleRouter.delete('/:id', (req: AuthRequest, res: Response) => {
  const id = Number(req.params['id']);
  const userId = getUserId(req);
  const person = getDb().prepare('SELECT * FROM people WHERE id = ? AND user_id = ?').get(id, userId);
  if (!person) { res.status(404).json(fail('Person not found')); return; }
  getDb().prepare('DELETE FROM task_people WHERE person_id = ?').run(id);
  getDb().prepare('DELETE FROM meeting_people WHERE person_id = ?').run(id);
  getDb().prepare('DELETE FROM people_projects WHERE person_id = ?').run(id);
  getDb().prepare('DELETE FROM people WHERE id = ?').run(id);
  searchService.removeRecord('person', id);
  res.json(ok({ deleted: true }));
});

peopleRouter.get('/:id/history', (req: AuthRequest, res: Response) => {
  const person = getDb().prepare('SELECT * FROM people WHERE id = ?').get(Number(req.params['id']));
  if (!person) { res.status(404).json(fail('Person not found')); return; }
  const meetings = getDb().prepare('SELECT m.id, m.title, m.date FROM meetings m JOIN meeting_people mp ON m.id = mp.meeting_id WHERE mp.person_id = ? ORDER BY m.date DESC').all(Number(req.params['id']));
  const agreements = getDb().prepare('SELECT * FROM agreements WHERE person_id = ? ORDER BY created_at DESC').all(Number(req.params['id']));
  const tasks = getDb().prepare('SELECT t.id, t.title, t.status FROM tasks t JOIN task_people tp ON t.id = tp.task_id WHERE tp.person_id = ?').all(Number(req.params['id']));
  res.json(ok({ person, meetings, agreements, tasks }));
});
