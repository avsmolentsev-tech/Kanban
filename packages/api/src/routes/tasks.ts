import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';

export const tasksRouter = Router();

const CreateSchema = z.object({
  project_id: z.number().int().optional(),
  title: z.string().min(1),
  description: z.string().optional().default(''),
  status: z.enum(['backlog', 'todo', 'in_progress', 'done']).optional().default('backlog'),
  priority: z.number().int().min(1).max(5).optional().default(3),
  urgency: z.number().int().min(1).max(5).optional().default(3),
  due_date: z.string().optional(),
  start_date: z.string().optional(),
  person_ids: z.array(z.number().int()).optional(),
});

const UpdateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(['backlog', 'todo', 'in_progress', 'done']).optional(),
  priority: z.number().int().min(1).max(5).optional(),
  urgency: z.number().int().min(1).max(5).optional(),
  due_date: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  archived: z.boolean().optional(),
  project_id: z.number().int().nullable().optional(),
  person_ids: z.array(z.number().int()).optional(),
});

const MoveSchema = z.object({
  status: z.enum(['backlog', 'todo', 'in_progress', 'done']),
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
  return tasks.map((t) => ({ ...t, people: byTask.get(t['id'] as number) ?? [] }));
}

function setTaskPeople(taskId: number, personIds: number[]) {
  const db = getDb();
  db.prepare('DELETE FROM task_people WHERE task_id = ?').run(taskId);
  for (const pid of personIds) {
    db.prepare('INSERT OR IGNORE INTO task_people (task_id, person_id) VALUES (?, ?)').run(taskId, pid);
  }
}

tasksRouter.get('/', (req: Request, res: Response) => {
  let query = 'SELECT * FROM tasks WHERE archived = 0';
  const params: unknown[] = [];
  if (req.query['project']) { query += ' AND project_id = ?'; params.push(Number(req.query['project'])); }
  if (req.query['status']) { query += ' AND status = ?'; params.push(req.query['status']); }
  if (req.query['person']) { query += ' AND id IN (SELECT task_id FROM task_people WHERE person_id = ?)'; params.push(Number(req.query['person'])); }
  query += ' ORDER BY order_index ASC, created_at DESC';
  const tasks = getDb().prepare(query).all(...params) as Record<string, unknown>[];
  res.json(ok(enrichTasksWithPeople(tasks)));
});

tasksRouter.post('/', (req: Request, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { project_id, title, description, status, priority, urgency, due_date, start_date, person_ids } = parsed.data;
  const result = getDb().prepare('INSERT INTO tasks (project_id, title, description, status, priority, urgency, due_date, start_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(project_id ?? null, title, description, status, priority, urgency, due_date ?? null, start_date ?? null);
  const taskId = result.lastInsertRowid as number;
  if (person_ids && person_ids.length > 0) {
    setTaskPeople(taskId, person_ids);
  }
  const task = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Record<string, unknown>;
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
  res.json(ok(enrichTasksWithPeople([task])[0]));
});

tasksRouter.patch('/:id/move', (req: Request, res: Response) => {
  const parsed = MoveSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  getDb().prepare(`UPDATE tasks SET status = ?, order_index = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`).run(parsed.data.status, parsed.data.order_index, Number(req.params['id']));
  res.json(ok(getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(Number(req.params['id']))));
});

tasksRouter.delete('/:id', (req: Request, res: Response) => {
  getDb().prepare(`UPDATE tasks SET archived = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`).run(Number(req.params['id']));
  res.json(ok({ archived: true }));
});
