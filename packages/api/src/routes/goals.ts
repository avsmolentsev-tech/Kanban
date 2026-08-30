import { Router, Response } from 'express';
import { z } from 'zod';
import { query, queryAll, queryOne, execute } from '../db/db';
import { ok, fail } from '@pis/shared';
import type { AuthRequest } from '../middleware/auth';
import { getUserId, userScopeWhere } from '../middleware/user-scope';
import { ClaudeService } from '../services/claude.service';

export const goalsRouter = Router();

const CreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(''),
  type: z.enum(['goal', 'key_result', 'bhag', 'milestone']).optional().default('goal'),
  parent_id: z.number().int().nullable().optional(),
  project_id: z.number().int().nullable().optional(),
  target_value: z.number().nullable().optional(),
  unit: z.string().optional().default('%'),
  due_date: z.string().nullable().optional(),
});

const UpdateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  type: z.enum(['goal', 'key_result']).optional(),
  parent_id: z.number().int().nullable().optional(),
  project_id: z.number().int().nullable().optional(),
  target_value: z.number().nullable().optional(),
  current_value: z.number().optional(),
  unit: z.string().optional(),
  due_date: z.string().nullable().optional(),
  status: z.enum(['active', 'completed', 'cancelled']).optional(),
});

goalsRouter.get('/', async (req: AuthRequest, res: Response) => {
  const scope = userScopeWhere(req);
  const goals = await queryAll<Record<string, unknown>>(
    `SELECT * FROM goals WHERE type IN ('goal', 'bhag') AND ${scope.sql} ORDER BY created_at DESC`,
    scope.params
  );

  const goalIds = goals.map((g) => g['id'] as number);
  let keyResults: Record<string, unknown>[] = [];
  if (goalIds.length > 0) {
    const placeholders = goalIds.map((_, i) => `$${i + 1}`).join(',');
    keyResults = await queryAll<Record<string, unknown>>(
      `SELECT * FROM goals WHERE type IN ('key_result', 'milestone') AND parent_id IN (${placeholders}) ORDER BY created_at ASC`,
      goalIds
    );
  }

  const krByParent = new Map<number, Record<string, unknown>[]>();
  for (const kr of keyResults) {
    const pid = kr['parent_id'] as number;
    if (!krByParent.has(pid)) krByParent.set(pid, []);
    krByParent.get(pid)!.push(kr);
  }

  const enriched = goals.map((g) => ({
    ...g,
    key_results: krByParent.get(g['id'] as number) ?? [],
  }));

  res.json(ok(enriched));
});

goalsRouter.post('/', async (req: AuthRequest, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(fail(parsed.error.message));
    return;
  }
  const { title, description, type, parent_id, project_id, target_value, unit, due_date } = parsed.data;
  const userId = getUserId(req);
  const inserted = await queryOne<{ id: number }>(
    'INSERT INTO goals (title, description, type, parent_id, project_id, target_value, unit, due_date, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id',
    [title, description, type, parent_id ?? null, project_id ?? null, target_value ?? null, unit, due_date ?? null, userId]
  );
  const goal = await queryOne('SELECT * FROM goals WHERE id = $1', [inserted!.id]);
  res.status(201).json(ok(goal));
});

goalsRouter.patch('/:id', async (req: AuthRequest, res: Response) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(fail(parsed.error.message));
    return;
  }
  const goalId = Number(req.params['id']);
  const userId = getUserId(req);
  const existing = await queryOne('SELECT id FROM goals WHERE id = $1 AND user_id = $2', [goalId, userId]);
  if (!existing) { res.status(404).json(fail('Goal not found')); return; }
  const entries = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) {
    res.status(400).json(fail('No fields'));
    return;
  }
  const fields = entries.map(([k], i) => `${k} = $${i + 1}`);
  const values = entries.map(([, v]) => v);
  await execute(
    `UPDATE goals SET ${fields.join(', ')} WHERE id = $${values.length + 1}`,
    [...values, goalId]
  );
  const goal = await queryOne('SELECT * FROM goals WHERE id = $1', [goalId]);
  res.json(ok(goal));
});

goalsRouter.get('/:id/mindmap', async (req: AuthRequest, res: Response) => {
  const goalId = Number(req.params['id']);
  const userId = getUserId(req);
  if (!userId) { res.status(401).json(fail('Auth required')); return; }

  const bhag = await queryOne<Record<string, unknown>>('SELECT * FROM goals WHERE id = $1 AND user_id = $2', [goalId, userId]);
  if (!bhag) { res.status(404).json(fail('Goal not found')); return; }

  // Milestones (direct children)
  const milestones = await queryAll<Record<string, unknown>>('SELECT * FROM goals WHERE parent_id = $1 AND user_id = $2', [goalId, userId]);
  const milestoneIds = milestones.map(m => m['id'] as number);

  // Tasks linked to milestones or directly to BHAG
  const allGoalIds = [goalId, ...milestoneIds];
  const placeholders = allGoalIds.map((_, i) => `$${i + 1}`).join(',');
  const tasks = allGoalIds.length > 0
    ? await queryAll<Record<string, unknown>>(
        `SELECT id, title, status, priority, due_date, goal_id FROM tasks WHERE goal_id IN (${placeholders}) AND user_id = $${allGoalIds.length + 1} AND archived = 0`,
        [...allGoalIds, userId]
      )
    : [];

  const meetings = allGoalIds.length > 0
    ? await queryAll<Record<string, unknown>>(
        `SELECT id, title, date, goal_id FROM meetings WHERE goal_id IN (${placeholders}) AND user_id = $${allGoalIds.length + 1}`,
        [...allGoalIds, userId]
      )
    : [];

  // Build nodes + edges
  type MindMapNode = { id: string; type: string; label: string; progress: number; status: string; due_date?: string; parent?: string };
  const nodes: MindMapNode[] = [];
  const edges: Array<{ source: string; target: string; edgeType?: string }> = [];

  // Helper: calculate progress
  const calcProgress = (items: Array<Record<string, unknown>>): number => {
    if (items.length === 0) return 0;
    const done = items.filter(i => i['status'] === 'done').length;
    return Math.round((done / items.length) * 100);
  };

  const getStatus = (progress: number): string => {
    if (progress === 100) return 'done';
    if (progress > 0) return 'in_progress';
    return 'not_started';
  };

  // Milestone nodes
  for (const m of milestones) {
    const mId = m['id'] as number;
    const childTasks = tasks.filter(t => t['goal_id'] === mId);
    const childMeetings = meetings.filter(mt => mt['goal_id'] === mId);
    const allChildren = [...childTasks, ...childMeetings.map(mt => ({ ...mt, status: mt['processed'] ? 'done' : 'todo' }))];
    const progress = calcProgress(allChildren);
    const mNode: MindMapNode = { id: `goal-${mId}`, type: 'milestone', label: m['title'] as string, progress, status: getStatus(progress), parent: `goal-${goalId}` };
    if (m['due_date']) mNode.due_date = m['due_date'] as string;
    nodes.push(mNode);
    edges.push({ source: `goal-${goalId}`, target: `goal-${mId}` });

    // Task nodes under this milestone
    for (const t of childTasks) {
      const tId = t['id'] as number;
      const tp = t['status'] === 'done' ? 100 : 0;
      const tNode: MindMapNode = { id: `task-${tId}`, type: 'task', label: t['title'] as string, progress: tp, status: t['status'] as string, parent: `goal-${mId}` };
      if (t['due_date']) tNode.due_date = t['due_date'] as string;
      nodes.push(tNode);
      edges.push({ source: `goal-${mId}`, target: `task-${tId}` });
    }

    // Meeting nodes under this milestone
    for (const mt of childMeetings) {
      const mtId = mt['id'] as number;
      const mtNode: MindMapNode = { id: `meeting-${mtId}`, type: 'meeting', label: mt['title'] as string, progress: 0, status: 'todo', parent: `goal-${mId}` };
      if (mt['date']) mtNode.due_date = mt['date'] as string;
      nodes.push(mtNode);
      edges.push({ source: `goal-${mId}`, target: `meeting-${mtId}` });
    }
  }

  // Subtasks (children of displayed tasks via parent_id)
  const displayedTaskIds = tasks.map(t => t['id'] as number);
  if (displayedTaskIds.length > 0) {
    const subPlaceholders = displayedTaskIds.map((_, i) => `$${i + 1}`).join(',');
    const subtasks = await queryAll<Record<string, unknown>>(
      `SELECT id, title, status, priority, due_date, parent_id FROM tasks WHERE parent_id IN (${subPlaceholders}) AND user_id = $${displayedTaskIds.length + 1} AND archived = 0`,
      [...displayedTaskIds, userId]
    );

    for (const st of subtasks) {
      const stId = st['id'] as number;
      const parentTaskId = st['parent_id'] as number;
      const sp = st['status'] === 'done' ? 100 : 0;
      const stNode: MindMapNode = { id: `task-${stId}`, type: 'task', label: st['title'] as string, progress: sp, status: st['status'] as string, parent: `task-${parentTaskId}` };
      if (st['due_date']) stNode.due_date = st['due_date'] as string;
      nodes.push(stNode);
      edges.push({ source: `task-${parentTaskId}`, target: `task-${stId}` });
    }
  }

  // Dependency edges between displayed tasks
  const allTaskIds = nodes.filter(n => n.id.startsWith('task-')).map(n => Number(n.id.split('-')[1]));
  if (allTaskIds.length > 0) {
    const depPlaceholders = allTaskIds.map((_, i) => `$${i + 1}`).join(',');
    const deps = await queryAll<{ task_id: number; depends_on_id: number }>(
      `SELECT task_id, depends_on_id FROM task_dependencies WHERE task_id IN (${depPlaceholders}) AND depends_on_id IN (${depPlaceholders})`,
      allTaskIds
    );
    for (const dep of deps) {
      edges.push({ source: `task-${dep.depends_on_id}`, target: `task-${dep.task_id}`, edgeType: 'dependency' });
    }
  }

  // BHAG node
  const milestoneProgresses = milestones.map(m => {
    const node = nodes.find(n => n.id === `goal-${m['id']}`);
    return node?.progress ?? 0;
  });
  const bhagProgress = milestoneProgresses.length > 0
    ? Math.round(milestoneProgresses.reduce((a, b) => a + b, 0) / milestoneProgresses.length)
    : 0;

  const bhagNode: MindMapNode = { id: `goal-${goalId}`, type: 'bhag', label: bhag['title'] as string, progress: bhagProgress, status: getStatus(bhagProgress) };
  if (bhag['due_date']) bhagNode.due_date = bhag['due_date'] as string;
  nodes.unshift(bhagNode);

  res.json(ok({ bhag: { id: goalId, title: bhag['title'], progress: bhagProgress }, nodes, edges }));
});

// Save mind map positions
goalsRouter.put('/:id/mindmap-positions', async (req: AuthRequest, res: Response) => {
  const goalId = Number(req.params['id']);
  const userId = getUserId(req);
  if (!userId) { res.status(401).json(fail('Auth required')); return; }
  const positions = req.body['positions'];
  if (!positions || typeof positions !== 'object') { res.status(400).json(fail('positions object required')); return; }
  const settingsKey = `mindmap_positions_${goalId}`;
  const jsonValue = JSON.stringify(positions);
  const existing = await queryOne('SELECT 1 FROM settings WHERE user_id = $1 AND key = $2', [userId, settingsKey]);
  if (existing) {
    await execute('UPDATE settings SET value = $1 WHERE user_id = $2 AND key = $3', [jsonValue, userId, settingsKey]);
  } else {
    await execute('INSERT INTO settings (user_id, key, value) VALUES ($1, $2, $3)', [userId, settingsKey, jsonValue]);
  }
  res.json(ok({ saved: true }));
});

// Get saved positions
goalsRouter.get('/:id/mindmap-positions', async (req: AuthRequest, res: Response) => {
  const goalId = Number(req.params['id']);
  const userId = getUserId(req);
  if (!userId) { res.status(401).json(fail('Auth required')); return; }
  const row = await queryOne<{ value: string }>('SELECT value FROM settings WHERE user_id = $1 AND key = $2', [userId, `mindmap_positions_${goalId}`]);
  res.json(ok(row ? JSON.parse(row.value) : {}));
});

goalsRouter.post('/:id/decompose', async (req: AuthRequest, res: Response) => {
  const goalId = Number(req.params['id']);
  const userId = getUserId(req);
  if (!userId) { res.status(401).json(fail('Auth required')); return; }

  const bhag = await queryOne<Record<string, unknown>>('SELECT * FROM goals WHERE id = $1 AND user_id = $2', [goalId, userId]);
  if (!bhag) { res.status(404).json(fail('Goal not found')); return; }

  try {
    const claude = new ClaudeService();
    const projects = await queryAll<{ name: string }>('SELECT name FROM projects WHERE user_id = $1 AND archived = 0', [userId]);
    const today = new Date().toISOString().split('T')[0]!;
    const result = await claude.decomposeBhag(
      bhag['title'] as string,
      (bhag['description'] as string) ?? '',
      projects.map(p => p.name),
      today,
    );

    // Save milestones + tasks + meetings
    const created: { milestones: number; tasks: number; meetings: number } = { milestones: 0, tasks: 0, meetings: 0 };

    for (const m of result.milestones) {
      const mResult = await queryOne<{ id: number }>(
        'INSERT INTO goals (title, type, parent_id, due_date, status, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [m.title, 'milestone', goalId, m.due_date ?? null, 'active', userId]
      );
      const milestoneId = mResult!.id;
      created.milestones++;

      for (const t of m.tasks ?? []) {
        await execute(
          'INSERT INTO tasks (title, status, priority, urgency, due_date, goal_id, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [t.title, 'todo', 3, 3, t.due_date ?? null, milestoneId, userId]
        );
        created.tasks++;
      }

      for (const mt of m.meetings ?? []) {
        await execute(
          'INSERT INTO meetings (title, date, goal_id, user_id, processed) VALUES ($1, $2, $3, $4, $5)',
          [mt.title, mt.date ?? today, milestoneId, userId, 0]
        );
        created.meetings++;
      }
    }

    res.json(ok({ ...created, milestones_data: result.milestones }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Decomposition failed'));
  }
});

goalsRouter.patch('/:id/nodes', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json(fail('Auth required')); return; }
  const moves = req.body['moves'] as Array<{ nodeId: string; newParent: string }> | undefined;
  if (!moves || !Array.isArray(moves)) { res.status(400).json(fail('moves array required')); return; }

  for (const move of moves) {
    const [nodeType, nodeIdStr] = move.nodeId.split('-');
    const [, parentIdStr] = move.newParent.split('-');
    const nodeId = Number(nodeIdStr);
    const parentId = Number(parentIdStr);
    if (!nodeId || !parentId) continue;

    if (nodeType === 'task') {
      await execute('UPDATE tasks SET goal_id = $1 WHERE id = $2 AND user_id = $3', [parentId, nodeId, userId]);
    } else if (nodeType === 'meeting') {
      await execute('UPDATE meetings SET goal_id = $1 WHERE id = $2 AND user_id = $3', [parentId, nodeId, userId]);
    } else if (nodeType === 'goal') {
      await execute('UPDATE goals SET parent_id = $1 WHERE id = $2 AND user_id = $3', [parentId, nodeId, userId]);
    }
  }

  res.json(ok({ moved: moves.length }));
});

goalsRouter.post('/:id/tasks-to-kanban', async (req: AuthRequest, res: Response) => {
  const goalId = Number(req.params['id']);
  const userId = getUserId(req);
  if (!userId) { res.status(401).json(fail('Auth required')); return; }

  const goal = await queryOne<{ project_id: number | null }>('SELECT project_id FROM goals WHERE id = $1 AND user_id = $2', [goalId, userId]);
  if (!goal) { res.status(404).json(fail('Goal not found')); return; }
  const projectId = (req.body['project_id'] as number | null) ?? goal.project_id;

  const updates: string[] = ["status = CASE WHEN status = 'backlog' THEN 'todo' ELSE status END"];
  const params: unknown[] = [];
  if (projectId) {
    updates.push(`project_id = $${params.length + 1}`);
    params.push(projectId);
  }

  const result = await execute(
    `UPDATE tasks SET ${updates.join(', ')} WHERE goal_id = $${params.length + 1} AND user_id = $${params.length + 2} AND archived = 0`,
    [...params, goalId, userId]
  );

  res.json(ok({ updated: result }));
});

goalsRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  const goalId = Number(req.params['id']);
  const userId = getUserId(req);
  const existing = await queryOne('SELECT id FROM goals WHERE id = $1 AND user_id = $2', [goalId, userId]);
  if (!existing) { res.status(404).json(fail('Goal not found')); return; }
  // Delete key results first
  await execute('DELETE FROM goals WHERE parent_id = $1 AND user_id = $2', [goalId, userId]);
  await execute('DELETE FROM goals WHERE id = $1 AND user_id = $2', [goalId, userId]);
  res.json(ok({ deleted: true }));
});
