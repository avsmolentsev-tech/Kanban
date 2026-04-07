import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';
import { searchService } from '../services/search.service';

export const peopleRouter = Router();

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

peopleRouter.get('/', (_req: Request, res: Response) => {
  const people = getDb().prepare('SELECT * FROM people ORDER BY name ASC').all() as Record<string, unknown>[];
  res.json(ok(attachProjects(people)));
});

peopleRouter.post('/', (req: Request, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { name, company, role, telegram, email, phone, notes, project_id, project_ids } = parsed.data;

  // Determine effective project_ids: prefer explicit project_ids, fall back to project_id
  const effectiveIds: number[] = project_ids && project_ids.length > 0
    ? project_ids
    : project_id != null ? [project_id] : [];

  const result = getDb().prepare('INSERT INTO people (name, company, role, telegram, email, phone, notes, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(name, company, role, telegram, email, phone, notes, effectiveIds[0] ?? null);
  const newId = result.lastInsertRowid as number;

  if (effectiveIds.length > 0) {
    const insertPP = getDb().prepare('INSERT OR IGNORE INTO people_projects (person_id, project_id) VALUES (?, ?)');
    for (const pid of effectiveIds) insertPP.run(newId, pid);
  }

  const person = getDb().prepare('SELECT * FROM people WHERE id = ?').get(newId) as Record<string, unknown>;
  searchService.indexRecord('person', newId, name, notes ?? '');
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
});

peopleRouter.patch('/:id', (req: Request, res: Response) => {
  const parsed = UpdatePersonSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const id = Number(req.params['id']);
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

  const fields = Object.entries(rest).filter(([, v]) => v !== undefined).map(([k]) => `${k} = ?`);
  const values = Object.entries(rest).filter(([, v]) => v !== undefined).map(([, v]) => v);

  if (fields.length > 0) {
    getDb().prepare(`UPDATE people SET ${fields.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`).run(...values, id);
  }

  const person = getDb().prepare('SELECT * FROM people WHERE id = ?').get(id) as Record<string, unknown>;
  if (person) searchService.indexRecord('person', person['id'] as number, person['name'] as string, (person['notes'] as string) ?? '');
  const [withProjects] = attachProjects([person]);
  res.json(ok(withProjects));
});

peopleRouter.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  const person = getDb().prepare('SELECT * FROM people WHERE id = ?').get(id);
  if (!person) { res.status(404).json(fail('Person not found')); return; }
  getDb().prepare('DELETE FROM task_people WHERE person_id = ?').run(id);
  getDb().prepare('DELETE FROM meeting_people WHERE person_id = ?').run(id);
  getDb().prepare('DELETE FROM people_projects WHERE person_id = ?').run(id);
  getDb().prepare('DELETE FROM people WHERE id = ?').run(id);
  searchService.removeRecord('person', id);
  res.json(ok({ deleted: true }));
});

peopleRouter.get('/:id/history', (req: Request, res: Response) => {
  const person = getDb().prepare('SELECT * FROM people WHERE id = ?').get(Number(req.params['id']));
  if (!person) { res.status(404).json(fail('Person not found')); return; }
  const meetings = getDb().prepare('SELECT m.id, m.title, m.date FROM meetings m JOIN meeting_people mp ON m.id = mp.meeting_id WHERE mp.person_id = ? ORDER BY m.date DESC').all(Number(req.params['id']));
  const agreements = getDb().prepare('SELECT * FROM agreements WHERE person_id = ? ORDER BY created_at DESC').all(Number(req.params['id']));
  const tasks = getDb().prepare('SELECT t.id, t.title, t.status FROM tasks t JOIN task_people tp ON t.id = tp.task_id WHERE tp.person_id = ?').all(Number(req.params['id']));
  res.json(ok({ person, meetings, agreements, tasks }));
});
