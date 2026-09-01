import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import multer from 'multer';
import { query, queryAll, queryOne, execute } from '../db/db';
import { ok, fail } from '@pis/shared';
import { searchService } from '../services/search.service';
import { ObsidianService } from '../services/obsidian.service';
import { config } from '../config';
import type { AuthRequest } from '../middleware/auth';
import { getUserId } from '../middleware/user-scope';
import { attachmentFileFilter, taskAttachmentFilename } from '../utils/upload-filter';

const obsidian = new ObsidianService(config.vaultPath);

const attachDir = path.join(config.vaultPath, 'Attachments');
if (!fs.existsSync(attachDir)) fs.mkdirSync(attachDir, { recursive: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 }, fileFilter: attachmentFileFilter });

export const tasksRouter = Router();

/** Verify task belongs to user. Returns false and sends 404 if not. */
async function verifyTaskOwner(req: AuthRequest, res: Response): Promise<boolean> {
  const taskId = Number(req.params['id']);
  const userId = getUserId(req);
  if (userId == null) { res.status(401).json(fail('Not authenticated')); return false; }
  const task = await queryOne('SELECT id FROM tasks WHERE id = $1 AND user_id = $2', [taskId, userId]);
  if (!task) { res.status(404).json(fail('Task not found')); return false; }
  return true;
}

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

async function enrichTasksWithPeople(tasks: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  if (tasks.length === 0) return tasks;
  const taskIds = tasks.map((t) => t['id']);
  const placeholders = taskIds.map((_, i) => `$${i + 1}`).join(',');
  const rows = await queryAll<{ task_id: number; id: number; name: string }>(
    `SELECT tp.task_id, p.id, p.name FROM task_people tp JOIN people p ON p.id = tp.person_id WHERE tp.task_id IN (${placeholders})`,
    taskIds
  );
  const byTask = new Map<number, Array<{ id: number; name: string }>>();
  for (const r of rows) {
    if (!byTask.has(r.task_id)) byTask.set(r.task_id, []);
    byTask.get(r.task_id)!.push({ id: r.id, name: r.name });
  }
  // Fetch subtasks with their assigned people
  const subPlaceholders = taskIds.map((_, i) => `$${i + 1}`).join(',');
  const subtasks = await queryAll<{ id: number; title: string; status: string; priority: number; parent_id: number }>(
    `SELECT id, title, status, priority, parent_id FROM tasks WHERE parent_id IN (${subPlaceholders}) AND archived = 0 ORDER BY created_at`,
    taskIds
  );
  const subIds = subtasks.map(s => s.id);
  const subPeopleMap = new Map<number, Array<{ id: number; name: string }>>();
  if (subIds.length > 0) {
    const subIdPlaceholders = subIds.map((_, i) => `$${i + 1}`).join(',');
    const subPeopleRows = await queryAll<{ task_id: number; id: number; name: string }>(
      `SELECT tp.task_id, p.id, p.name FROM task_people tp JOIN people p ON p.id = tp.person_id WHERE tp.task_id IN (${subIdPlaceholders})`,
      subIds
    );
    for (const r of subPeopleRows) {
      if (!subPeopleMap.has(r.task_id)) subPeopleMap.set(r.task_id, []);
      subPeopleMap.get(r.task_id)!.push({ id: r.id, name: r.name });
    }
  }
  const subByParent = new Map<number, Array<{ id: number; title: string; status: string; people: Array<{ id: number; name: string }> }>>();
  for (const s of subtasks) {
    if (!subByParent.has(s.parent_id)) subByParent.set(s.parent_id, []);
    subByParent.get(s.parent_id)!.push({ id: s.id, title: s.title, status: s.status, people: subPeopleMap.get(s.id) ?? [] });
  }
  // Fetch tags
  const tagPlaceholders = taskIds.map((_, i) => `$${i + 1}`).join(',');
  const tagRows = await queryAll<{ task_id: number; id: number; name: string; color: string }>(
    `SELECT tt.task_id, t.id, t.name, t.color FROM task_tags tt JOIN tags t ON t.id = tt.tag_id WHERE tt.task_id IN (${tagPlaceholders})`,
    taskIds
  );
  const tagsByTask = new Map<number, Array<{ id: number; name: string; color: string }>>();
  for (const r of tagRows) {
    if (!tagsByTask.has(r.task_id)) tagsByTask.set(r.task_id, []);
    tagsByTask.get(r.task_id)!.push({ id: r.id, name: r.name, color: r.color });
  }

  // Fetch dependencies count
  const depPlaceholders = taskIds.map((_, i) => `$${i + 1}`).join(',');
  const depRows = await queryAll<{ task_id: number; cnt: number }>(
    `SELECT task_id, COUNT(*) as cnt FROM task_dependencies WHERE task_id IN (${depPlaceholders}) GROUP BY task_id`,
    taskIds
  );
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

async function setTaskPeople(taskId: number, personIds: number[]): Promise<void> {
  await execute('DELETE FROM task_people WHERE task_id = $1', [taskId]);
  for (const pid of personIds) {
    await execute('INSERT INTO task_people (task_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [taskId, pid]);
  }
}

/** Find self person id (named "Я", "Me", or similar) */
export async function getSelfPersonId(): Promise<number | null> {
  try {
    const row = await queryOne<{ id: number }>("SELECT id FROM people WHERE LOWER(name) IN ('я','me','я','self') ORDER BY id LIMIT 1", []);
    return row?.id ?? null;
  } catch {
    return null;
  }
}

export interface TaskListFilters {
  project_id?: number | undefined;
  status?: string | undefined;
  person_id?: number | undefined;
}

/** Список задач пользователя. Используется и HTTP-роутом, и MCP-инструментом list_tasks — одна и та же выборка. */
export async function listTasksForUser(userId: number, filters: TaskListFilters = {}): Promise<Record<string, unknown>[]> {
  let sql = 'SELECT * FROM tasks WHERE archived = 0 AND parent_id IS NULL AND user_id = $1';
  const params: unknown[] = [userId];
  if (filters.project_id != null) { sql += ` AND project_id = $${params.length + 1}`; params.push(filters.project_id); }
  if (filters.status) { sql += ` AND status = $${params.length + 1}`; params.push(filters.status); }
  if (filters.person_id != null) { sql += ` AND id IN (SELECT task_id FROM task_people WHERE person_id = $${params.length + 1})`; params.push(filters.person_id); }
  sql += ' ORDER BY order_index ASC, created_at DESC';
  const tasks = await queryAll<Record<string, unknown>>(sql, params);
  return enrichTasksWithPeople(tasks);
}

tasksRouter.get('/', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (userId == null) { res.json(ok([])); return; } // fail-closed: без пользователя — пустой список, а не 1=0-запрос
  const tasks = await listTasksForUser(userId, {
    project_id: req.query['project'] ? Number(req.query['project']) : undefined,
    status: req.query['status'] ? String(req.query['status']) : undefined,
    person_id: req.query['person'] ? Number(req.query['person']) : undefined,
  });
  res.json(ok(tasks));
});

tasksRouter.get('/:id', async (req: AuthRequest, res: Response) => {
  const taskId = Number(req.params['id']);
  const userId = getUserId(req);
  const task = await queryOne<Record<string, unknown>>('SELECT * FROM tasks WHERE id = $1 AND user_id = $2', [taskId, userId]);
  if (!task) { res.status(404).json(fail('Task not found')); return; }
  res.json(ok(task));
});

export interface CreateTaskInput {
  project_id?: number | null | undefined;
  parent_id?: number | null | undefined;
  title: string;
  description?: string | undefined;
  status?: string | undefined;
  priority?: number | undefined;
  urgency?: number | undefined;
  due_date?: string | null | undefined;
  start_date?: string | null | undefined;
  person_ids?: number[] | undefined;
  recurrence?: string | null | undefined;
  goal_id?: number | null | undefined;
}

/** Создание задачи со всеми побочными эффектами (self-assign, sync в vault). Общий код для HTTP-роута и MCP-инструмента create_task. */
export async function createTaskForUser(userId: number, input: CreateTaskInput): Promise<Record<string, unknown>> {
  const {
    project_id = null, parent_id = null, title, description = '', status = 'backlog',
    priority = 3, urgency = 3, due_date = null, start_date = null, person_ids,
    recurrence = null, goal_id = null,
  } = input;
  // Security: verify project belongs to this user
  if (project_id) {
    const proj = await queryOne('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [project_id, userId]);
    if (!proj) throw new Error('Project not found or not yours');
  }
  const inserted = await queryOne<{ id: number }>(
    'INSERT INTO tasks (project_id, parent_id, title, description, status, priority, urgency, due_date, start_date, recurrence, goal_id, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id',
    [project_id, parent_id, title, description, status, priority, urgency, due_date, start_date, recurrence, goal_id, userId]
  );
  const taskId = inserted!.id;

  // Auto-add self if no people specified
  let effectivePeople = person_ids ?? [];
  if (effectivePeople.length === 0) {
    const selfId = await getSelfPersonId();
    if (selfId) effectivePeople = [selfId];
  }
  if (effectivePeople.length > 0) {
    await setTaskPeople(taskId, effectivePeople);
  }
  const task = await queryOne<Record<string, unknown>>('SELECT * FROM tasks WHERE id = $1', [taskId]);
  searchService.indexRecord('task', taskId, title, description);
  // Sync to vault
  try {
    const projectName = project_id ? (await queryOne<{ name: string }>('SELECT name FROM projects WHERE id = $1', [project_id]))?.name : undefined;
    const vaultPath = await obsidian.forUser(userId).writeTask({ title, status, priority, urgency, project: projectName, due_date });
    await execute('UPDATE tasks SET vault_path = $1 WHERE id = $2', [vaultPath, taskId]);
    (task as Record<string, unknown>)['vault_path'] = vaultPath;
  } catch {}
  return (await enrichTasksWithPeople([task!]))[0]!;
}

tasksRouter.post('/', async (req: AuthRequest, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const userId = getUserId(req);
  if (userId == null) { res.status(401).json(fail('Not authenticated')); return; }
  try {
    const task = await createTaskForUser(userId, parsed.data);
    res.status(201).json(ok(task));
  } catch (err) {
    res.status(400).json(fail(err instanceof Error ? err.message : 'Failed to create task'));
  }
});

export interface TaskPatch {
  title?: string | undefined;
  description?: string | undefined;
  status?: string | undefined;
  priority?: number | undefined;
  urgency?: number | undefined;
  due_date?: string | null | undefined;
  start_date?: string | null | undefined;
  archived?: boolean | undefined;
  project_id?: number | null | undefined;
  parent_id?: number | null | undefined;
  recurrence?: string | null | undefined;
  person_ids?: number[] | undefined;
}

/**
 * Частичное обновление задачи со всеми побочными эффектами (sync в vault). Общий код для
 * HTTP-роута PATCH /:id и MCP-инструментов (complete_task — частный случай с status: 'done').
 * Возвращает null, если задача не найдена или принадлежит другому пользователю.
 */
export async function updateTaskForUser(userId: number, taskId: number, patch: TaskPatch): Promise<Record<string, unknown> | null> {
  const owner = await queryOne('SELECT id FROM tasks WHERE id = $1 AND user_id = $2', [taskId, userId]);
  if (!owner) return null;
  const { person_ids, ...rest } = patch;
  const entries = Object.entries(rest).filter(([, v]) => v !== undefined);
  if (entries.length > 0) {
    const fields = entries.map(([k], i) => `${k} = $${i + 1}`);
    const values = entries.map(([, v]) => v);
    await execute(
      `UPDATE tasks SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${values.length + 1} AND user_id = $${values.length + 2}`,
      [...values, taskId, userId]
    );
  } else if (person_ids === undefined) {
    throw new Error('No fields');
  }
  if (person_ids !== undefined) {
    await setTaskPeople(taskId, person_ids);
  }
  const task = await queryOne<Record<string, unknown>>('SELECT * FROM tasks WHERE id = $1', [taskId]);
  if (task) {
    searchService.indexRecord('task', task['id'] as number, task['title'] as string, (task['description'] as string) ?? '');
    // Sync to vault
    try {
      const vp = task['vault_path'] as string | null;
      if (vp) {
        const projectName = task['project_id'] ? (await queryOne<{ name: string }>('SELECT name FROM projects WHERE id = $1', [task['project_id'] as number]))?.name : undefined;
        const company = (task['company'] as string | null) ?? undefined;
        const tagsRaw = task['tags'] as string | null;
        const tags = tagsRaw ? JSON.parse(tagsRaw) as string[] : undefined;
        const source = (task['source'] as string | null) ?? undefined;
        obsidian.forUser(userId).updateTask(vp, {
          title: task['title'] as string, status: task['status'] as string,
          priority: task['priority'] as number, urgency: task['urgency'] as number,
          project: projectName, due_date: task['due_date'] as string | null,
          company, tags, source,
        });
      }
    } catch {}
  }
  return (await enrichTasksWithPeople([task!]))[0]!;
}

/** Отметить задачу выполненной — частный случай updateTaskForUser, используется MCP-инструментом complete_task. */
export async function completeTaskForUser(userId: number, taskId: number): Promise<Record<string, unknown> | null> {
  return updateTaskForUser(userId, taskId, { status: 'done' });
}

tasksRouter.patch('/:id', async (req: AuthRequest, res: Response) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const taskId = Number(req.params['id']);
  const userId = getUserId(req);
  if (userId == null) { res.status(401).json(fail('Not authenticated')); return; }
  try {
    const task = await updateTaskForUser(userId, taskId, parsed.data);
    if (!task) { res.status(404).json(fail('Task not found')); return; }
    res.json(ok(task));
  } catch (err) {
    res.status(400).json(fail(err instanceof Error ? err.message : 'Update failed'));
  }
});

tasksRouter.patch('/:id/move', async (req: AuthRequest, res: Response) => {
  const parsed = MoveSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const taskId = Number(req.params['id']);
  const userId = getUserId(req);
  await execute(
    `UPDATE tasks SET status = $1, order_index = $2, updated_at = NOW() WHERE id = $3 AND user_id = $4`,
    [parsed.data.status, parsed.data.order_index, taskId, userId]
  );
  const task = await queryOne<Record<string, unknown>>('SELECT * FROM tasks WHERE id = $1', [taskId]);
  // Sync to vault
  try {
    const vp = task!['vault_path'] as string | null;
    if (vp) {
      const projectName = task!['project_id'] ? (await queryOne<{ name: string }>('SELECT name FROM projects WHERE id = $1', [task!['project_id'] as number]))?.name : undefined;
      obsidian.forUser(getUserId(req)).updateTask(vp, {
        title: task!['title'] as string, status: parsed.data.status,
        priority: task!['priority'] as number, urgency: task!['urgency'] as number,
        project: projectName, due_date: task!['due_date'] as string | null,
      });
    }
  } catch {}
  res.json(ok(task));
});

tasksRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  const task = await queryOne<{ vault_path: string | null }>('SELECT vault_path FROM tasks WHERE id = $1 AND user_id = $2', [Number(req.params['id']), userId]);
  if (!task) { res.status(404).json(fail('Task not found')); return; }
  await execute(`UPDATE tasks SET archived = 1, updated_at = NOW() WHERE id = $1 AND user_id = $2`, [Number(req.params['id']), userId]);
  // Move vault file to trash
  try { if (task?.vault_path) obsidian.forUser(getUserId(req)).deleteFile(task.vault_path); } catch {}
  res.json(ok({ archived: true }));
});

// Process recurring tasks (scoped to calling user)
tasksRouter.post('/process-recurring', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (userId == null) { res.status(401).json(fail('Authentication required')); return; }
  const doneTasks = await queryAll<Record<string, unknown>>("SELECT * FROM tasks WHERE status = 'done' AND recurrence IS NOT NULL AND archived = 0 AND user_id = $1", [userId]);
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
    const newTask = await queryOne<{ id: number }>(
      'INSERT INTO tasks (user_id, project_id, parent_id, title, description, status, priority, urgency, due_date, start_date, recurrence) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id',
      [userId, t['project_id'] ?? null, t['parent_id'] ?? null, t['title'], t['description'], 'todo', t['priority'], t['urgency'], nextDue, t['start_date'] ?? null, t['recurrence']]
    );
    created.push(newTask!.id);
    await execute('UPDATE tasks SET recurrence = NULL WHERE id = $1 AND user_id = $2', [t['id'], userId]);
  }
  res.json(ok({ processed: doneTasks.length, created_ids: created }));
});

// Task comments
tasksRouter.get('/:id/comments', async (req: AuthRequest, res: Response) => {
  if (!await verifyTaskOwner(req, res)) return;
  const comments = await queryAll('SELECT * FROM task_comments WHERE task_id = $1 ORDER BY created_at DESC', [Number(req.params['id'])]);
  res.json(ok(comments));
});

tasksRouter.post('/:id/comments', async (req: AuthRequest, res: Response) => {
  if (!await verifyTaskOwner(req, res)) return;
  const { text } = req.body;
  if (!text || typeof text !== 'string') { res.status(400).json(fail('Text required')); return; }
  const inserted = await queryOne<{ id: number }>('INSERT INTO task_comments (task_id, text) VALUES ($1, $2) RETURNING id', [Number(req.params['id']), text.trim()]);
  const comment = await queryOne('SELECT * FROM task_comments WHERE id = $1', [inserted!.id]);
  res.json(ok(comment));
});

tasksRouter.delete('/:id/comments/:commentId', async (req: AuthRequest, res: Response) => {
  if (!await verifyTaskOwner(req, res)) return;
  await execute('DELETE FROM task_comments WHERE id = $1 AND task_id = $2', [Number(req.params['commentId']), Number(req.params['id'])]);
  res.json(ok({ deleted: true }));
});

// Task dependencies
tasksRouter.get('/:id/dependencies', async (req: AuthRequest, res: Response) => {
  if (!await verifyTaskOwner(req, res)) return;
  const taskId = Number(req.params['id']);
  const deps = await queryAll(
    'SELECT t.id, t.title, t.status, t.priority FROM task_dependencies td JOIN tasks t ON t.id = td.depends_on_id WHERE td.task_id = $1',
    [taskId]
  );
  res.json(ok(deps));
});

tasksRouter.post('/:id/dependencies', async (req: AuthRequest, res: Response) => {
  if (!await verifyTaskOwner(req, res)) return;
  const taskId = Number(req.params['id']);
  const { depends_on_id } = req.body;
  if (!depends_on_id || typeof depends_on_id !== 'number') { res.status(400).json(fail('depends_on_id required')); return; }
  if (depends_on_id === taskId) { res.status(400).json(fail('Cannot depend on itself')); return; }
  try {
    await execute('INSERT INTO task_dependencies (task_id, depends_on_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [taskId, depends_on_id]);
    res.json(ok({ task_id: taskId, depends_on_id }));
  } catch (err) {
    res.status(400).json(fail('Failed to add dependency'));
  }
});

tasksRouter.delete('/:id/dependencies/:depId', async (req: AuthRequest, res: Response) => {
  if (!await verifyTaskOwner(req, res)) return;
  const taskId = Number(req.params['id']);
  const depId = Number(req.params['depId']);
  await execute('DELETE FROM task_dependencies WHERE task_id = $1 AND depends_on_id = $2', [taskId, depId]);
  res.json(ok({ deleted: true }));
});

// Task attachments
tasksRouter.post('/:id/attachments', upload.single('file'), async (req: AuthRequest, res: Response) => {
  if (!await verifyTaskOwner(req, res)) return;
  const taskId = Number(req.params['id']);
  if (!req.file) { res.status(400).json(fail('Файл не предоставлен')); return; }

  const ext = path.extname(req.file.originalname);
  // Файл отдаётся публично (routes/index.ts) без авторизации — непредсказуемость
  // имени держится на randomAttachmentToken() внутри generator'а, а не на id/времени.
  const filename = taskAttachmentFilename(taskId, ext);
  fs.writeFileSync(path.join(attachDir, filename), req.file.buffer);

  const inserted = await queryOne<{ id: number }>(
    'INSERT INTO attachments (task_id, filename, original_name, size, mime_type) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [taskId, filename, req.file.originalname, req.file.size, req.file.mimetype]
  );
  const attachment = await queryOne('SELECT * FROM attachments WHERE id = $1', [inserted!.id]);
  res.status(201).json(ok(attachment));
});

tasksRouter.get('/:id/attachments', async (req: AuthRequest, res: Response) => {
  if (!await verifyTaskOwner(req, res)) return;
  const atts = await queryAll('SELECT * FROM attachments WHERE task_id = $1 ORDER BY created_at DESC', [Number(req.params['id'])]);
  res.json(ok(atts));
});
