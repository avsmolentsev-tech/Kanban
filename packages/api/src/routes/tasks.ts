import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import multer from 'multer';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';
import { searchService } from '../services/search.service';
import { ObsidianService } from '../services/obsidian.service';
import { config } from '../config';
import type { AuthRequest } from '../middleware/auth';
import { getUserId, userScopeWhere } from '../middleware/user-scope';

const obsidian = new ObsidianService(config.vaultPath);

const attachDir = path.join(config.vaultPath, 'Attachments');
if (!fs.existsSync(attachDir)) fs.mkdirSync(attachDir, { recursive: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

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
  recurrence: z.string().nullable().optional(),
  goal_id: z.number().int().nullable().optional(),
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
  recurrence: z.string().nullable().optional(),
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
  // Fetch tags
  const tagRows = getDb()
    .prepare(`SELECT tt.task_id, t.id, t.name, t.color FROM task_tags tt JOIN tags t ON t.id = tt.tag_id WHERE tt.task_id IN (${taskIds.map(() => '?').join(',')})`)
    .all(...taskIds) as Array<{ task_id: number; id: number; name: string; color: string }>;
  const tagsByTask = new Map<number, Array<{ id: number; name: string; color: string }>>();
  for (const r of tagRows) {
    if (!tagsByTask.has(r.task_id)) tagsByTask.set(r.task_id, []);
    tagsByTask.get(r.task_id)!.push({ id: r.id, name: r.name, color: r.color });
  }

  // Fetch dependencies count
  const depRows = getDb()
    .prepare(`SELECT task_id, COUNT(*) as cnt FROM task_dependencies WHERE task_id IN (${taskIds.map(() => '?').join(',')}) GROUP BY task_id`)
    .all(...taskIds) as Array<{ task_id: number; cnt: number }>;
  const depsByTask = new Map<number, number>();
  for (const r of depRows) depsByTask.set(r.task_id, r.cnt);

  return tasks.map((t) => ({
    ...t,
    people: byTask.get(t['id'] as number) ?? [],
    subtasks: subByParent.get(t['id'] as number) ?? [],
    tags: tagsByTask.get(t['id'] as number) ?? [],
    dependencies_count: depsByTask.get(t['id'] as number) ?? 0,
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

tasksRouter.get('/', (req: AuthRequest, res: Response) => {
  const scope = userScopeWhere(req);
  let query = 'SELECT * FROM tasks WHERE archived = 0 AND parent_id IS NULL AND ' + scope.sql;
  const params: unknown[] = [...scope.params];
  if (req.query['project']) { query += ' AND project_id = ?'; params.push(Number(req.query['project'])); }
  if (req.query['status']) { query += ' AND status = ?'; params.push(req.query['status']); }
  if (req.query['person']) { query += ' AND id IN (SELECT task_id FROM task_people WHERE person_id = ?)'; params.push(Number(req.query['person'])); }
  query += ' ORDER BY order_index ASC, created_at DESC';
  const tasks = getDb().prepare(query).all(...params) as Record<string, unknown>[];
  res.json(ok(enrichTasksWithPeople(tasks)));
});

tasksRouter.get('/:id', (req: AuthRequest, res: Response) => {
  const taskId = Number(req.params['id']);
  const userId = getUserId(req);
  const task = getDb().prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(taskId, userId) as Record<string, unknown> | undefined;
  if (!task) { res.status(404).json(fail('Task not found')); return; }
  res.json(ok(task));
});

tasksRouter.post('/', async (req: AuthRequest, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { project_id, parent_id, title, description, status, priority, urgency, due_date, start_date, person_ids, recurrence, goal_id } = parsed.data;
  const userId = getUserId(req);
  const result = getDb().prepare('INSERT INTO tasks (project_id, parent_id, title, description, status, priority, urgency, due_date, start_date, recurrence, goal_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(project_id ?? null, parent_id ?? null, title, description, status, priority, urgency, due_date ?? null, start_date ?? null, recurrence ?? null, goal_id ?? null, userId);
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
    const vaultPath = await obsidian.forUser(getUserId(req)).writeTask({ title, status, priority, urgency, project: projectName, due_date });
    getDb().prepare('UPDATE tasks SET vault_path = ? WHERE id = ?').run(vaultPath, taskId);
    (task as Record<string, unknown>)['vault_path'] = vaultPath;
  } catch {}
  res.status(201).json(ok(enrichTasksWithPeople([task])[0]));
});

tasksRouter.patch('/:id', (req: AuthRequest, res: Response) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { person_ids, ...rest } = parsed.data;
  const taskId = Number(req.params['id']);
  const userId = getUserId(req);
  const owner = getDb().prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?').get(taskId, userId);
  if (!owner) { res.status(404).json(fail('Task not found')); return; }
  const fields = Object.entries(rest).filter(([, v]) => v !== undefined).map(([k]) => `${k} = ?`);
  const values = Object.values(rest).filter((v) => v !== undefined);
  if (fields.length > 0) {
    getDb().prepare(`UPDATE tasks SET ${fields.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND user_id = ?`).run(...values, taskId, userId);
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
        const company = (task['company'] as string | null) ?? undefined;
        const tagsRaw = task['tags'] as string | null;
        const tags = tagsRaw ? JSON.parse(tagsRaw) as string[] : undefined;
        const source = (task['source'] as string | null) ?? undefined;
        obsidian.forUser(getUserId(req)).updateTask(vp, {
          title: task['title'] as string, status: task['status'] as string,
          priority: task['priority'] as number, urgency: task['urgency'] as number,
          project: projectName, due_date: task['due_date'] as string | null,
          company, tags, source,
        });
      }
    } catch {}
  }
  res.json(ok(enrichTasksWithPeople([task])[0]));
});

tasksRouter.patch('/:id/move', (req: AuthRequest, res: Response) => {
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
      obsidian.forUser(getUserId(req)).updateTask(vp, {
        title: task['title'] as string, status: parsed.data.status,
        priority: task['priority'] as number, urgency: task['urgency'] as number,
        project: projectName, due_date: task['due_date'] as string | null,
      });
    }
  } catch {}
  res.json(ok(task));
});

tasksRouter.delete('/:id', (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  const task = getDb().prepare('SELECT vault_path FROM tasks WHERE id = ? AND user_id = ?').get(Number(req.params['id']), userId) as { vault_path: string | null } | undefined;
  if (!task) { res.status(404).json(fail('Task not found')); return; }
  getDb().prepare(`UPDATE tasks SET archived = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND user_id = ?`).run(Number(req.params['id']), userId);
  // Move vault file to trash
  try { if (task?.vault_path) obsidian.forUser(getUserId(req)).deleteFile(task.vault_path); } catch {}
  res.json(ok({ archived: true }));
});

// Process recurring tasks (scoped to calling user)
tasksRouter.post('/process-recurring', (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (userId == null) { res.status(401).json(fail('Authentication required')); return; }
  const db = getDb();
  const doneTasks = db.prepare("SELECT * FROM tasks WHERE status = 'done' AND recurrence IS NOT NULL AND archived = 0 AND user_id = ?").all(userId) as Record<string, unknown>[];
  const created: number[] = [];
  for (const t of doneTasks) {
    let nextDue: string | null = null;
    if (t['due_date']) {
      const d = new Date(t['due_date'] as string);
      if (t['recurrence'] === 'daily') d.setDate(d.getDate() + 1);
      else if (t['recurrence'] === 'weekly') d.setDate(d.getDate() + 7);
      else if (t['recurrence'] === 'monthly') d.setMonth(d.getMonth() + 1);
      nextDue = d.toISOString().split('T')[0];
    }
    const result = db.prepare(
      'INSERT INTO tasks (user_id, project_id, parent_id, title, description, status, priority, urgency, due_date, start_date, recurrence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      userId, t['project_id'] ?? null, t['parent_id'] ?? null, t['title'], t['description'],
      'todo', t['priority'], t['urgency'], nextDue, t['start_date'] ?? null, t['recurrence']
    );
    created.push(result.lastInsertRowid as number);
    db.prepare('UPDATE tasks SET recurrence = NULL WHERE id = ? AND user_id = ?').run(t['id'], userId);
  }
  res.json(ok({ processed: doneTasks.length, created_ids: created }));
});

// Task comments
tasksRouter.get('/:id/comments', (req: AuthRequest, res: Response) => {
  const comments = getDb().prepare('SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at DESC').all(Number(req.params['id']));
  res.json(ok(comments));
});

tasksRouter.post('/:id/comments', (req: AuthRequest, res: Response) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string') { res.status(400).json(fail('Text required')); return; }
  const result = getDb().prepare('INSERT INTO task_comments (task_id, text) VALUES (?, ?)').run(Number(req.params['id']), text.trim());
  const comment = getDb().prepare('SELECT * FROM task_comments WHERE id = ?').get(result.lastInsertRowid);
  res.json(ok(comment));
});

tasksRouter.delete('/:id/comments/:commentId', (req: AuthRequest, res: Response) => {
  getDb().prepare('DELETE FROM task_comments WHERE id = ? AND task_id = ?').run(Number(req.params['commentId']), Number(req.params['id']));
  res.json(ok({ deleted: true }));
});

// Task dependencies
tasksRouter.get('/:id/dependencies', (req: AuthRequest, res: Response) => {
  const taskId = Number(req.params['id']);
  const deps = getDb().prepare(
    'SELECT t.id, t.title, t.status, t.priority FROM task_dependencies td JOIN tasks t ON t.id = td.depends_on_id WHERE td.task_id = ?'
  ).all(taskId);
  res.json(ok(deps));
});

tasksRouter.post('/:id/dependencies', (req: AuthRequest, res: Response) => {
  const taskId = Number(req.params['id']);
  const { depends_on_id } = req.body;
  if (!depends_on_id || typeof depends_on_id !== 'number') { res.status(400).json(fail('depends_on_id required')); return; }
  if (depends_on_id === taskId) { res.status(400).json(fail('Cannot depend on itself')); return; }
  try {
    getDb().prepare('INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)').run(taskId, depends_on_id);
    res.json(ok({ task_id: taskId, depends_on_id }));
  } catch (err) {
    res.status(400).json(fail('Failed to add dependency'));
  }
});

tasksRouter.delete('/:id/dependencies/:depId', (req: AuthRequest, res: Response) => {
  const taskId = Number(req.params['id']);
  const depId = Number(req.params['depId']);
  getDb().prepare('DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?').run(taskId, depId);
  res.json(ok({ deleted: true }));
});

// Task attachments
tasksRouter.post('/:id/attachments', upload.single('file'), (req: AuthRequest, res: Response) => {
  const taskId = Number(req.params['id']);
  if (!req.file) { res.status(400).json(fail('Файл не предоставлен')); return; }

  const ext = path.extname(req.file.originalname);
  const filename = `task-${taskId}-${Date.now()}${ext}`;
  fs.writeFileSync(path.join(attachDir, filename), req.file.buffer);

  const result = getDb().prepare(
    'INSERT INTO attachments (task_id, filename, original_name, size, mime_type) VALUES (?, ?, ?, ?, ?)'
  ).run(taskId, filename, req.file.originalname, req.file.size, req.file.mimetype);
  const attachment = getDb().prepare('SELECT * FROM attachments WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(ok(attachment));
});

tasksRouter.get('/:id/attachments', (req: AuthRequest, res: Response) => {
  const atts = getDb().prepare('SELECT * FROM attachments WHERE task_id = ? ORDER BY created_at DESC').all(Number(req.params['id']));
  res.json(ok(atts));
});
