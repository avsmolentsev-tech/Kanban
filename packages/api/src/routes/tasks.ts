import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';
import { searchService } from '../services/search.service';
import { ObsidianService } from '../services/obsidian.service';
import { config } from '../config';

const obsidian = new ObsidianService(config.vaultPath);

export const tasksRouter = Router();

const CreateSchema = z.object({
  project_id: z.number().int().optional(),
  parent_id: z.number().int().nullable().optional(),
  title: z.string().min(1),
  description: z.string().optional().default(''),
  status: z.enum(['backlog', 'todo', 'in_progress', 'done', 'someday']).optional().default('backlog'),
  priority: z.number().int().min(1).max(5).optional().default(3),
  urgency: z.number().int().min(1).max(5).optional().default(3),
  due_date: z.string().optional(),
  start_date: z.string().optional(),
  person_ids: z.array(z.number().int()).optional(),
});

const UpdateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(['backlog', 'todo', 'in_progress', 'done', 'someday']).optional(),
  priority: z.number().int().min(1).max(5).optional(),
  urgency: z.number().int().min(1).max(5).optional(),
  due_date: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  archived: z.boolean().optional(),
  project_id: z.number().int().nullable().optional(),
  parent_id: z.number().int().nullable().optional(),
  person_ids: z.array(z.number().int()).optional(),
});

const MoveSchema = z.object({
  status: z.enum(['backlog', 'todo', 'in_progress', 'done', 'someday']),
  order_index: z.number().int(),
});

function enrichTasksWithPeople(tasks: Record<string, unknown>[]): Record<string, unknown>[] {
  if (tasks.length === 0) return tasks;
  const taskIds = tasks.map((t) => t['id']);
  const rows = getDb()
    .prepare(`SELECT tp.task_id, p.id, p.name FROM task_people tp JOIN people p ON p.id = tp.person_id WHERE tp.task_id IN (${taskIds.map(() => '?').join(',')})`)
    .all(...taskIds) as Array<{ task_id: number; id: number; name: string }>;
  const byTask = new Map<number, Array<{ id: number; name: string }>>();
  for (const r of rows) {
    if (!byTask.has(r.task_id)) byTask.set(r.task_id, []);
    byTask.get(r.task_id)!.push({ id: r.id, name: r.name });
  }
  // Fetch subtasks
  const subtasks = getDb()
    .prepare(`SELECT id, title, status, priority FROM tasks WHERE parent_id IN (${taskIds.map(() => '?').join(',')}) AND archived = 0 ORDER BY created_at`)
    .all(...taskIds) as Array<{ id: number; title: string; status: string; priority: number; parent_id?: number }>;
  const subByParent = new Map<number, Array<{ id: number; title: string; status: string }>>();
  for (const s of subtasks) {
    const pid = (s as Record<string, unknown>)['parent_id'] as number;
    if (!subByParent.has(pid)) subByParent.set(pid, []);
    subByParent.get(pid)!.push({ id: s.id, title: s.title, status: s.status });
  }
  return tasks.map((t) => ({
    ...t,
    people: byTask.get(t['id'] as number) ?? [],
    subtasks: subByParent.get(t['id'] as number) ?? [],
  }));
}

function setTaskPeople(taskId: number, personIds: number[]) {
  const db = getDb();
  db.prepare('DELETE FROM task_people WHERE task_id = ?').run(taskId);
  for (const pid of personIds) {
    db.prepare('INSERT OR IGNORE INTO task_people (task_id, person_id) VALUES (?, ?)').run(taskId, pid);
  }
}

/** Find self person id (named "Я", "Me", or similar) */
export function getSelfPersonId(): number | null {
  try {
    const row = getDb().prepare("SELECT id FROM people WHERE LOWER(name) IN ('я','me','я','self') ORDER BY id LIMIT 1").get() as { id: number } | undefined;
    return row?.id ?? null;
  } catch {
    return null;
  }
}

tasksRouter.get('/', (req: Request, res: Response) => {
  let query = 'SELECT * FROM tasks WHERE archived = 0 AND parent_id IS NULL';
  const params: unknown[] = [];
  if (req.query['project']) { query += ' AND project_id = ?'; params.push(Number(req.query['project'])); }
  if (req.query['status']) { query += ' AND status = ?'; params.push(req.query['status']); }
  if (req.query['person']) { query += ' AND id IN (SELECT task_id FROM task_people WHERE person_id = ?)'; params.push(Number(req.query['person'])); }
  query += ' ORDER BY order_index ASC, created_at DESC';
  const tasks = getDb().prepare(query).all(...params) as Record<string, unknown>[];
  res.json(ok(enrichTasksWithPeople(tasks)));
});

tasksRouter.post('/', async (req: Request, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { project_id, parent_id, title, description, status, priority, urgency, due_date, start_date, person_ids } = parsed.data;
  const result = getDb().prepare('INSERT INTO tasks (project_id, parent_id, title, description, status, priority, urgency, due_date, start_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(project_id ?? null, parent_id ?? null, title, description, status, priority, urgency, due_date ?? null, start_date ?? null);
  const taskId = result.lastInsertRowid as number;

  // Auto-add self if no people specified
  let effectivePeople = person_ids ?? [];
  if (effectivePeople.length === 0) {
    const selfId = getSelfPersonId();
    if (selfId) effectivePeople = [selfId];
  }
  if (effectivePeople.length > 0) {
    setTaskPeople(taskId, effectivePeople);
  }
  const task = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Record<string, unknown>;
  searchService.indexRecord('task', taskId, parsed.data.title, parsed.data.description ?? '');
  // Sync to vault
  try {
    const projectName = project_id ? (getDb().prepare('SELECT name FROM projects WHERE id = ?').get(project_id) as { name: string } | undefined)?.name : undefined;
    const vaultPath = await obsidian.writeTask({ title, status, priority, urgency, project: projectName, due_date });
    getDb().prepare('UPDATE tasks SET vault_path = ? WHERE id = ?').run(vaultPath, taskId);
    (task as Record<string, unknown>)['vault_path'] = vaultPath;
  } catch {}
  res.status(201).json(ok(enrichTasksWithPeople([task])[0]));
});

tasksRouter.patch('/:id', (req: Request, res: Response) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { person_ids, ...rest } = parsed.data;
  const taskId = Number(req.params['id']);
  const fields = Object.entries(rest).filter(([, v]) => v !== undefined).map(([k]) => `${k} = ?`);
  const values = Object.values(rest).filter((v) => v !== undefined);
  if (fields.length > 0) {
    getDb().prepare(`UPDATE tasks SET ${fields.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`).run(...values, taskId);
  } else if (person_ids === undefined) {
    res.status(400).json(fail('No fields')); return;
  }
  if (person_ids !== undefined) {
    setTaskPeople(taskId, person_ids);
  }
  const task = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Record<string, unknown>;
  if (task) {
    searchService.indexRecord('task', task['id'] as number, task['title'] as string, (task['description'] as string) ?? '');
    // Sync to vault
    try {
      const vp = task['vault_path'] as string | null;
      if (vp) {
        const projectName = task['project_id'] ? (getDb().prepare('SELECT name FROM projects WHERE id = ?').get(task['project_id'] as number) as { name: string } | undefined)?.name : undefined;
        obsidian.updateTask(vp, {
          title: task['title'] as string, status: task['status'] as string,
          priority: task['priority'] as number, urgency: task['urgency'] as number,
          project: projectName, due_date: task['due_date'] as string | null,
        });
      }
    } catch {}
  }
  res.json(ok(enrichTasksWithPeople([task])[0]));
});

tasksRouter.patch('/:id/move', (req: Request, res: Response) => {
  const parsed = MoveSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const taskId = Number(req.params['id']);
  getDb().prepare(`UPDATE tasks SET status = ?, order_index = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`).run(parsed.data.status, parsed.data.order_index, taskId);
  const task = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Record<string, unknown>;
  // Sync to vault
  try {
    const vp = task['vault_path'] as string | null;
    if (vp) {
      const projectName = task['project_id'] ? (getDb().prepare('SELECT name FROM projects WHERE id = ?').get(task['project_id'] as number) as { name: string } | undefined)?.name : undefined;
      obsidian.updateTask(vp, {
        title: task['title'] as string, status: parsed.data.status,
        priority: task['priority'] as number, urgency: task['urgency'] as number,
        project: projectName, due_date: task['due_date'] as string | null,
      });
    }
  } catch {}
  res.json(ok(task));
});

tasksRouter.delete('/:id', (req: Request, res: Response) => {
  const task = getDb().prepare('SELECT vault_path FROM tasks WHERE id = ?').get(Number(req.params['id'])) as { vault_path: string | null } | undefined;
  getDb().prepare(`UPDATE tasks SET archived = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`).run(Number(req.params['id']));
  // Move vault file to trash
  try { if (task?.vault_path) obsidian.deleteFile(task.vault_path); } catch {}
  res.json(ok({ archived: true }));
});
