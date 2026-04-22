import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';
import type { AuthRequest } from '../middleware/auth';
import { getUserId, userScopeWhere } from '../middleware/user-scope';
import { ClaudeService } from '../services/claude.service';

export const goalsRouter = Router();

const CreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(''),
  type: z.enum(['goal', 'key_result']).optional().default('goal'),
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

goalsRouter.get('/', (req: AuthRequest, res: Response) => {
  const scope = userScopeWhere(req);
  const goals = getDb()
    .prepare(`SELECT * FROM goals WHERE type = 'goal' AND ${scope.sql} ORDER BY created_at DESC`)
    .all(...scope.params) as Record<string, unknown>[];

  const goalIds = goals.map((g) => g['id'] as number);
  let keyResults: Record<string, unknown>[] = [];
  if (goalIds.length > 0) {
    keyResults = getDb()
      .prepare(
        `SELECT * FROM goals WHERE type = 'key_result' AND parent_id IN (${goalIds.map(() => '?').join(',')}) ORDER BY created_at ASC`
      )
      .all(...goalIds) as Record<string, unknown>[];
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

goalsRouter.post('/', (req: AuthRequest, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(fail(parsed.error.message));
    return;
  }
  const { title, description, type, parent_id, project_id, target_value, unit, due_date } = parsed.data;
  const userId = getUserId(req);
  const result = getDb()
    .prepare(
      'INSERT INTO goals (title, description, type, parent_id, project_id, target_value, unit, due_date, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(title, description, type, parent_id ?? null, project_id ?? null, target_value ?? null, unit, due_date ?? null, userId);
  const goal = getDb().prepare('SELECT * FROM goals WHERE id = ?').get(result.lastInsertRowid as number);
  res.status(201).json(ok(goal));
});

goalsRouter.patch('/:id', (req: AuthRequest, res: Response) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(fail(parsed.error.message));
    return;
  }
  const goalId = Number(req.params['id']);
  const userId = getUserId(req);
  const existing = getDb().prepare('SELECT id FROM goals WHERE id = ? AND user_id = ?').get(goalId, userId);
  if (!existing) { res.status(404).json(fail('Goal not found')); return; }
  const entries = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) {
    res.status(400).json(fail('No fields'));
    return;
  }
  const fields = entries.map(([k]) => `${k} = ?`);
  const values = entries.map(([, v]) => v);
  getDb()
    .prepare(`UPDATE goals SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values, goalId);
  const goal = getDb().prepare('SELECT * FROM goals WHERE id = ?').get(goalId);
  res.json(ok(goal));
});

goalsRouter.get('/:id/mindmap', (req: AuthRequest, res: Response) => {
  const goalId = Number(req.params['id']);
  const userId = getUserId(req);
  if (!userId) { res.status(401).json(fail('Auth required')); return; }
  const db = getDb();

  const bhag = db.prepare('SELECT * FROM goals WHERE id = ? AND user_id = ?').get(goalId, userId) as Record<string, unknown> | undefined;
  if (!bhag) { res.status(404).json(fail('Goal not found')); return; }

  // Milestones (direct children)
  const milestones = db.prepare('SELECT * FROM goals WHERE parent_id = ? AND user_id = ?').all(goalId, userId) as Array<Record<string, unknown>>;
  const milestoneIds = milestones.map(m => m['id'] as number);

  // Tasks linked to milestones or directly to BHAG
  const allGoalIds = [goalId, ...milestoneIds];
  const placeholders = allGoalIds.map(() => '?').join(',');
  const tasks = allGoalIds.length > 0
    ? db.prepare(`SELECT id, title, status, priority, due_date, goal_id FROM tasks WHERE goal_id IN (${placeholders}) AND user_id = ? AND archived = 0`).all(...allGoalIds, userId) as Array<Record<string, unknown>>
    : [];

  const meetings = allGoalIds.length > 0
    ? db.prepare(`SELECT id, title, date, goal_id FROM meetings WHERE goal_id IN (${placeholders}) AND user_id = ?`).all(...allGoalIds, userId) as Array<Record<string, unknown>>
    : [];

  // Build nodes + edges
  const nodes: Array<{ id: string; type: string; label: string; progress: number; status: string; due_date?: string; parent?: string }> = [];
  const edges: Array<{ source: string; target: string }> = [];

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
    nodes.push({
      id: `goal-${mId}`,
      type: 'milestone',
      label: m['title'] as string,
      progress,
      status: getStatus(progress),
      due_date: m['due_date'] as string | undefined,
      parent: `goal-${goalId}`,
    });
    edges.push({ source: `goal-${goalId}`, target: `goal-${mId}` });

    // Task nodes under this milestone
    for (const t of childTasks) {
      const tId = t['id'] as number;
      const tp = t['status'] === 'done' ? 100 : 0;
      nodes.push({ id: `task-${tId}`, type: 'task', label: t['title'] as string, progress: tp, status: t['status'] as string, due_date: t['due_date'] as string | undefined, parent: `goal-${mId}` });
      edges.push({ source: `goal-${mId}`, target: `task-${tId}` });
    }

    // Meeting nodes under this milestone
    for (const mt of childMeetings) {
      const mtId = mt['id'] as number;
      nodes.push({ id: `meeting-${mtId}`, type: 'meeting', label: mt['title'] as string, progress: 0, status: 'todo', due_date: mt['date'] as string | undefined, parent: `goal-${mId}` });
      edges.push({ source: `goal-${mId}`, target: `meeting-${mtId}` });
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

  nodes.unshift({
    id: `goal-${goalId}`,
    type: 'bhag',
    label: bhag['title'] as string,
    progress: bhagProgress,
    status: getStatus(bhagProgress),
    due_date: bhag['due_date'] as string | undefined,
  });

  res.json(ok({ bhag: { id: goalId, title: bhag['title'], progress: bhagProgress }, nodes, edges }));
});

goalsRouter.post('/:id/decompose', async (req: AuthRequest, res: Response) => {
  const goalId = Number(req.params['id']);
  const userId = getUserId(req);
  if (!userId) { res.status(401).json(fail('Auth required')); return; }
  const db = getDb();

  const bhag = db.prepare('SELECT * FROM goals WHERE id = ? AND user_id = ?').get(goalId, userId) as Record<string, unknown> | undefined;
  if (!bhag) { res.status(404).json(fail('Goal not found')); return; }

  try {
    const claude = new ClaudeService();
    const projects = db.prepare('SELECT name FROM projects WHERE user_id = ? AND archived = 0').all(userId) as Array<{ name: string }>;
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
      const mResult = db.prepare(
        'INSERT INTO goals (title, type, parent_id, due_date, status, user_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(m.title, 'milestone', goalId, m.due_date ?? null, 'active', userId);
      const milestoneId = Number(mResult.lastInsertRowid);
      created.milestones++;

      for (const t of m.tasks ?? []) {
        db.prepare(
          'INSERT INTO tasks (title, status, priority, urgency, due_date, goal_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(t.title, 'todo', 3, 3, t.due_date ?? null, milestoneId, userId);
        created.tasks++;
      }

      for (const mt of m.meetings ?? []) {
        db.prepare(
          'INSERT INTO meetings (title, date, goal_id, user_id, processed) VALUES (?, ?, ?, ?, 0)'
        ).run(mt.title, mt.date ?? today, milestoneId, userId);
        created.meetings++;
      }
    }

    res.json(ok({ ...created, milestones_data: result.milestones }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Decomposition failed'));
  }
});

goalsRouter.delete('/:id', (req: AuthRequest, res: Response) => {
  const goalId = Number(req.params['id']);
  const userId = getUserId(req);
  const existing = getDb().prepare('SELECT id FROM goals WHERE id = ? AND user_id = ?').get(goalId, userId);
  if (!existing) { res.status(404).json(fail('Goal not found')); return; }
  // Delete key results first
  getDb().prepare('DELETE FROM goals WHERE parent_id = ? AND user_id = ?').run(goalId, userId);
  getDb().prepare('DELETE FROM goals WHERE id = ? AND user_id = ?').run(goalId, userId);
  res.json(ok({ deleted: true }));
});
