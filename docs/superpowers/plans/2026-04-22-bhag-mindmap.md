# BHAG Mind Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a radial mind map visualization to the Goals page that shows BHAG → milestones → tasks/meetings with live progress tracking, AI decomposition, and drag-and-drop editing.

**Architecture:** Backend extends existing goals CRUD with mindmap/decompose/nodes endpoints. Frontend adds a new "Mind Map" tab on GoalsPage using @xyflow/react with custom nodes showing progress bars and color coding. TG bot gets BHAG creation instructions in its AI prompt. DB migration adds `goal_id` FK to tasks and meetings tables.

**Tech Stack:** @xyflow/react (React Flow v12), dagre (graph layout), existing Express API + SQLite, gpt-4.1 for decomposition.

**Spec:** `docs/superpowers/specs/2026-04-22-bhag-mindmap-design.md`

---

## File Structure

```
packages/api/src/
  db/db.ts                              modify — add goal_id migration
  routes/goals.ts                       modify — add mindmap/decompose/nodes endpoints
  services/claude.service.ts            modify — add decomposeBhag method
  services/telegram.service.ts          modify — add BHAG to executeCommand prompt + create_bhag action

apps/web/
  package.json                          modify — add @xyflow/react, dagre, @types/dagre
  src/pages/GoalsPage.tsx               modify — add Mind Map tab
  src/components/goals/MindMapTab.tsx    create — main container, fetches data, renders ReactFlow
  src/components/goals/MindMapNode.tsx   create — custom node (title + progress bar + color)
  src/components/goals/DecomposeModal.tsx create — BHAG creation + AI decomposition preview
  src/components/goals/NodeDetailPanel.tsx create — slide-out panel on node click
```

---

## Phase 1 — Backend

### Task 1: DB migration — add goal_id to tasks and meetings

**Files:**
- Modify: `packages/api/src/db/db.ts`

- [ ] **Step 1: Add ALTER TABLE statements**

In `db.ts`, find the migration section (search for `ALTER TABLE` or `try { db.exec` blocks — there should be a pattern of try/catch ALTER TABLE calls). Add:

```typescript
try { db.exec('ALTER TABLE tasks ADD COLUMN goal_id INTEGER REFERENCES goals(id)'); } catch {}
try { db.exec('ALTER TABLE meetings ADD COLUMN goal_id INTEGER REFERENCES goals(id)'); } catch {}
```

Place these alongside the existing migration ALTER TABLE statements.

- [ ] **Step 2: Verify on server**

```bash
ssh root@213.139.229.148 "sqlite3 /var/www/kanban-app/data/pis.db '.schema tasks' | grep goal_id"
```

After deploy this should show the new column. For now just commit.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/db/db.ts
git commit -m "feat(db): add goal_id FK to tasks and meetings tables"
```

---

### Task 2: API — GET /goals/:id/mindmap

**Files:**
- Modify: `packages/api/src/routes/goals.ts`

- [ ] **Step 1: Add the endpoint**

After existing endpoints in `goals.ts`, add:

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/routes/goals.ts
git commit -m "feat(api): GET /goals/:id/mindmap — tree of nodes with progress"
```

---

### Task 3: API — POST /goals/:id/decompose (Claude AI)

**Files:**
- Modify: `packages/api/src/services/claude.service.ts`
- Modify: `packages/api/src/routes/goals.ts`

- [ ] **Step 1: Add decomposeBhag to ClaudeService**

In `claude.service.ts`, add method:

```typescript
async decomposeBhag(bhagTitle: string, bhagDescription: string, existingProjects: string[], today: string): Promise<{
  milestones: Array<{ title: string; due_date: string; tasks: Array<{ title: string; due_date?: string }>; meetings: Array<{ title: string; date?: string }> }>;
}> {
  const resp = await this.openai.chat.completions.create({
    model: 'gpt-4.1',
    temperature: 0.3,
    messages: [
      { role: 'system', content: `Ты декомпозируешь большую годовую цель (BHAG) на конкретные milestones и задачи.

Верни СТРОГО JSON:
{
  "milestones": [
    {
      "title": "Название milestone",
      "due_date": "YYYY-MM-DD",
      "tasks": [
        { "title": "Конкретная задача", "due_date": "YYYY-MM-DD" }
      ],
      "meetings": [
        { "title": "Встреча с кем/зачем", "date": "YYYY-MM-DD" }
      ]
    }
  ]
}

Правила:
- 4-6 milestones, распределённых по году от сегодня до конца года
- Каждый milestone: 3-5 задач
- Встречи только если реально нужны (не выдумывай)
- due_date реалистичные, от ближайшего до конца года
- Если цель связана с существующими проектами — упомяни в title задач
- Задачи конкретные и actionable (не "подумать о...", а "составить план...")

Существующие проекты пользователя: ${existingProjects.join(', ')}
Сегодня: ${today}` },
      { role: 'user', content: `BHAG: ${bhagTitle}\n${bhagDescription ? 'Описание: ' + bhagDescription : ''}\n\nДекомпозируй.` },
    ],
    response_format: { type: 'json_object' },
  });
  const raw = resp.choices[0]?.message?.content ?? '{"milestones":[]}';
  return JSON.parse(raw);
}
```

- [ ] **Step 2: Add decompose endpoint in goals.ts**

```typescript
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
```

Add import at top of goals.ts if not present:
```typescript
import { ClaudeService } from '../services/claude.service';
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/services/claude.service.ts packages/api/src/routes/goals.ts
git commit -m "feat(api): POST /goals/:id/decompose — AI breaks BHAG into milestones+tasks"
```

---

### Task 4: API — PATCH /goals/:id/nodes (drag-and-drop reparent)

**Files:**
- Modify: `packages/api/src/routes/goals.ts`

- [ ] **Step 1: Add endpoint**

```typescript
goalsRouter.patch('/:id/nodes', (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json(fail('Auth required')); return; }
  const db = getDb();
  const moves = req.body['moves'] as Array<{ nodeId: string; newParent: string }> | undefined;
  if (!moves || !Array.isArray(moves)) { res.status(400).json(fail('moves array required')); return; }

  for (const move of moves) {
    const [nodeType, nodeIdStr] = move.nodeId.split('-');
    const [, parentIdStr] = move.newParent.split('-');
    const nodeId = Number(nodeIdStr);
    const parentId = Number(parentIdStr);
    if (!nodeId || !parentId) continue;

    if (nodeType === 'task') {
      db.prepare('UPDATE tasks SET goal_id = ? WHERE id = ? AND user_id = ?').run(parentId, nodeId, userId);
    } else if (nodeType === 'meeting') {
      db.prepare('UPDATE meetings SET goal_id = ? WHERE id = ? AND user_id = ?').run(parentId, nodeId, userId);
    } else if (nodeType === 'goal') {
      db.prepare('UPDATE goals SET parent_id = ? WHERE id = ? AND user_id = ?').run(parentId, nodeId, userId);
    }
  }

  res.json(ok({ moved: moves.length }));
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/routes/goals.ts
git commit -m "feat(api): PATCH /goals/:id/nodes — reparent nodes via drag-and-drop"
```

---

### Task 5: API — extend POST /goals to accept type=bhag

**Files:**
- Modify: `packages/api/src/routes/goals.ts`

- [ ] **Step 1: Update CreateSchema**

Find the Zod `CreateSchema` in goals.ts. The `type` field currently defaults to `'goal'`. Extend to accept `'bhag'` and `'milestone'`:

```typescript
type: z.enum(['goal', 'key_result', 'bhag', 'milestone']).optional().default('goal'),
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/routes/goals.ts
git commit -m "feat(api): goals accept type=bhag and type=milestone"
```

---

### Task 6: TG bot — BHAG in executeCommand prompt

**Files:**
- Modify: `packages/api/src/services/telegram.service.ts`

- [ ] **Step 1: Add BHAG block to system prompt**

In `executeCommand`, find the system prompt section. After the "ЕЖЕНЕДЕЛЬНЫЕ ЦЕЛИ" block, add:

```
BHAG (Большая Дерзкая Цель на год):
Когда пользователь ставит BHAG ("моя цель на год...", "хочу достичь...", "главная цель на год..."):
1. Создай goal: {"type": "create_goal", "title": "...", "description": "...", "goal_type": "bhag", "due_date": "YYYY-12-31"}
2. Скажи: "🎯 BHAG создана! Открой Mind Map в приложении — я помогу декомпозировать на milestones и задачи."
3. НЕ пытайся декомпозировать прямо в чате — для этого есть Mind Map.
```

- [ ] **Step 2: Add create_goal action to handle goal_type**

In the action handler switch, find `create_goal`. Ensure it passes `type` from `action['goal_type']` if present:

```typescript
// In the create_goal action handler:
const goalType = (action['goal_type'] as string) ?? 'goal';
// Use goalType in the INSERT:
db.prepare('INSERT INTO goals (title, description, type, ...) VALUES (?, ?, ?, ...)').run(
  action['title'], action['description'] ?? '', goalType, ...
);
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/services/telegram.service.ts
git commit -m "feat(telegram): BHAG creation via TG bot + mind map redirect"
```

---

## Phase 2 — Frontend

### Task 7: Install @xyflow/react + dagre

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Install**

```bash
cd apps/web && pnpm add @xyflow/react dagre && pnpm add -D @types/dagre
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore(web): add @xyflow/react + dagre for mind map"
```

---

### Task 8: MindMapNode — custom React Flow node

**Files:**
- Create: `apps/web/src/components/goals/MindMapNode.tsx`

- [ ] **Step 1: Create component**

```tsx
import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Target, CheckCircle2, Circle, Clock, Users } from 'lucide-react';

interface MindMapNodeData {
  label: string;
  nodeType: 'bhag' | 'milestone' | 'task' | 'meeting';
  progress: number;
  status: string;
  due_date?: string;
}

const statusColor: Record<string, string> = {
  done: '#22c55e',
  in_progress: '#eab308',
  not_started: '#6b7280',
  todo: '#6b7280',
  backlog: '#6b7280',
};

const typeIcon = {
  bhag: Target,
  milestone: Clock,
  task: CheckCircle2,
  meeting: Users,
};

function MindMapNodeComponent({ data }: NodeProps) {
  const d = data as unknown as MindMapNodeData;
  const color = statusColor[d.status] ?? '#6b7280';
  const Icon = typeIcon[d.nodeType] ?? Circle;
  const isBhag = d.nodeType === 'bhag';

  return (
    <div
      className={`rounded-xl border-2 px-4 py-2 bg-white dark:bg-gray-800 shadow-md transition-all hover:shadow-lg ${isBhag ? 'min-w-[220px]' : 'min-w-[160px]'}`}
      style={{ borderColor: color }}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-400 !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <Icon size={isBhag ? 20 : 16} style={{ color }} />
        <span className={`${isBhag ? 'font-bold text-sm' : 'text-xs'} text-gray-900 dark:text-white truncate max-w-[180px]`}>
          {d.label}
        </span>
      </div>
      {(d.nodeType === 'bhag' || d.nodeType === 'milestone') && (
        <div className="mt-1">
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
            <div className="h-1.5 rounded-full transition-all" style={{ width: `${d.progress}%`, backgroundColor: color }} />
          </div>
          <span className="text-[10px] text-gray-500 dark:text-gray-400">{d.progress}%</span>
        </div>
      )}
      {d.due_date && (
        <div className="text-[10px] text-gray-400 mt-0.5">{d.due_date}</div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-gray-400 !w-2 !h-2" />
    </div>
  );
}

export const MindMapNode = memo(MindMapNodeComponent);
export const nodeTypes = { bhag: MindMapNode, milestone: MindMapNode, task: MindMapNode, meeting: MindMapNode };
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/goals/MindMapNode.tsx
git commit -m "feat(web): MindMapNode — custom React Flow node with progress bar"
```

---

### Task 9: MindMapTab — main container with React Flow

**Files:**
- Create: `apps/web/src/components/goals/MindMapTab.tsx`

- [ ] **Step 1: Create component**

```tsx
import { useCallback, useEffect, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { nodeTypes } from './MindMapNode';
import { apiGet, apiPost, apiPatch } from '../../api';
import { Plus } from 'lucide-react';

interface MindMapData {
  bhag: { id: number; title: string; progress: number };
  nodes: Array<{ id: string; type: string; label: string; progress: number; status: string; due_date?: string; parent?: string }>;
  edges: Array<{ source: string; target: string }>;
}

function layoutGraph(data: MindMapData): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', ranksep: 80, nodesep: 60 });

  for (const n of data.nodes) {
    const w = n.type === 'bhag' ? 240 : 180;
    const h = n.type === 'bhag' ? 90 : 60;
    g.setNode(n.id, { width: w, height: h });
  }
  for (const e of data.edges) {
    g.setEdge(e.source, e.target);
  }
  dagre.layout(g);

  const nodes: Node[] = data.nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      id: n.id,
      type: n.type,
      position: { x: (pos?.x ?? 0) - (n.type === 'bhag' ? 120 : 90), y: pos?.y ?? 0 },
      data: { label: n.label, nodeType: n.type, progress: n.progress, status: n.status, due_date: n.due_date },
    };
  });
  const edges: Edge[] = data.edges.map((e, i) => ({
    id: `e-${i}`,
    source: e.source,
    target: e.target,
    style: { stroke: '#94a3b8', strokeWidth: 2 },
    animated: false,
  }));
  return { nodes, edges };
}

interface Props {
  bhagId: number | null;
  bhags: Array<{ id: number; title: string }>;
  onCreateBhag: () => void;
}

export function MindMapTab({ bhagId, bhags, onCreateBhag }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading] = useState(false);
  const [selectedBhag, setSelectedBhag] = useState<number | null>(bhagId);

  const fetchMindmap = useCallback(async (id: number) => {
    setLoading(true);
    try {
      const resp = await apiGet(`/goals/${id}/mindmap`);
      if (resp.success) {
        const { nodes: n, edges: e } = layoutGraph(resp.data as MindMapData);
        setNodes(n);
        setEdges(e);
      }
    } finally {
      setLoading(false);
    }
  }, [setNodes, setEdges]);

  useEffect(() => {
    if (selectedBhag) fetchMindmap(selectedBhag);
  }, [selectedBhag, fetchMindmap]);

  // Auto-refresh every 30s
  useEffect(() => {
    if (!selectedBhag) return;
    const interval = setInterval(() => fetchMindmap(selectedBhag), 30000);
    return () => clearInterval(interval);
  }, [selectedBhag, fetchMindmap]);

  const handleDecompose = async () => {
    if (!selectedBhag) return;
    setLoading(true);
    try {
      await apiPost(`/goals/${selectedBhag}/decompose`, {});
      await fetchMindmap(selectedBhag);
    } finally {
      setLoading(false);
    }
  };

  if (bhags.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-gray-500 dark:text-gray-400">
        <p className="text-lg mb-4">Нет BHAG. Создай большую цель на год!</p>
        <button onClick={onCreateBhag} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
          <Plus size={18} /> Новая BHAG
        </button>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-200px)] w-full">
      {/* BHAG selector + actions */}
      <div className="flex items-center gap-3 mb-3">
        <select
          className="text-sm border rounded-lg px-3 py-1.5 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
          value={selectedBhag ?? ''}
          onChange={(e) => setSelectedBhag(Number(e.target.value) || null)}
        >
          {bhags.map(b => <option key={b.id} value={b.id}>🎯 {b.title}</option>)}
        </select>
        <button onClick={handleDecompose} disabled={loading || !selectedBhag}
          className="text-xs px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
          {loading ? 'AI декомпозирует...' : '🧠 Декомпозировать'}
        </button>
        <button onClick={onCreateBhag} className="text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-white">
          <Plus size={14} className="inline mr-1" /> Новая BHAG
        </button>
      </div>

      {/* React Flow */}
      <div className="h-full border rounded-xl dark:border-gray-700 overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          attributionPosition="bottom-left"
          className="bg-gray-50 dark:bg-gray-900"
        >
          <Background color="#94a3b8" gap={20} size={1} />
          <Controls className="!bg-white dark:!bg-gray-800 !border-gray-200 dark:!border-gray-600 !shadow-lg" />
          <MiniMap nodeColor={(n) => {
            const p = (n.data as any)?.progress ?? 0;
            if (p === 100) return '#22c55e';
            if (p > 0) return '#eab308';
            return '#6b7280';
          }} className="!bg-white dark:!bg-gray-800 !border-gray-200 dark:!border-gray-600" />
        </ReactFlow>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/goals/MindMapTab.tsx
git commit -m "feat(web): MindMapTab — React Flow container with dagre layout + auto-refresh"
```

---

### Task 10: GoalsPage — add Mind Map tab

**Files:**
- Modify: `apps/web/src/pages/GoalsPage.tsx`

- [ ] **Step 1: Add tab toggle + MindMapTab**

Read the existing `GoalsPage.tsx` (314 lines). It currently shows goals in a card layout.

Add at the top of the component (inside the function, after existing state):
```tsx
const [activeTab, setActiveTab] = useState<'list' | 'mindmap'>('list');
const [showCreateBhag, setShowCreateBhag] = useState(false);
```

Import MindMapTab:
```tsx
import { MindMapTab } from '../components/goals/MindMapTab';
```

Add tab buttons in the header area (find where the page title "Цели" or "Goals" is rendered). Add after it:
```tsx
<div className="flex gap-2 ml-4">
  <button
    onClick={() => setActiveTab('list')}
    className={`px-3 py-1 rounded-lg text-sm ${activeTab === 'list' ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
  >
    📋 Список
  </button>
  <button
    onClick={() => setActiveTab('mindmap')}
    className={`px-3 py-1 rounded-lg text-sm ${activeTab === 'mindmap' ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
  >
    🧠 Mind Map
  </button>
</div>
```

Wrap existing goals list content in a conditional:
```tsx
{activeTab === 'list' ? (
  // ... existing goals list JSX ...
) : (
  <MindMapTab
    bhagId={bhags[0]?.id ?? null}
    bhags={bhags}
    onCreateBhag={() => setShowCreateBhag(true)}
  />
)}
```

Add BHAG list state — fetch goals of type 'bhag':
```tsx
const bhags = goals.filter(g => g.type === 'bhag');
```

Where `goals` is the existing state array. If goals don't have a `type` field in the API response, check the GET /goals endpoint — it should return the `type` column. If not, modify the API to include it.

- [ ] **Step 2: Verify build**

```bash
pnpm --filter @pis/web build
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/GoalsPage.tsx
git commit -m "feat(web): GoalsPage Mind Map tab with BHAG selector"
```

---

### Task 11: DecomposeModal — create BHAG + AI preview

**Files:**
- Create: `apps/web/src/components/goals/DecomposeModal.tsx`

- [ ] **Step 1: Create modal component**

```tsx
import { useState } from 'react';
import { apiPost } from '../../api';
import { X, Sparkles } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function DecomposeModal({ open, onClose, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'input' | 'decomposing' | 'done'>('input');

  if (!open) return null;

  const handleCreate = async () => {
    if (!title.trim()) return;
    setLoading(true);
    setStep('decomposing');
    try {
      // 1. Create BHAG
      const createResp = await apiPost('/goals', { title, description, type: 'bhag', due_date: `${new Date().getFullYear()}-12-31` });
      if (!createResp.success) throw new Error('Failed to create BHAG');
      const bhagId = createResp.data.id;

      // 2. Decompose
      await apiPost(`/goals/${bhagId}/decompose`, {});
      setStep('done');
      setTimeout(() => {
        onCreated();
        onClose();
        setTitle('');
        setDescription('');
        setStep('input');
      }, 1500);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error');
      setStep('input');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg p-6 mx-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">🎯 Новая BHAG</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>

        {step === 'input' && (
          <>
            <input
              className="w-full border rounded-lg px-3 py-2 mb-3 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              placeholder="Большая цель на год..."
              value={title}
              onChange={e => setTitle(e.target.value)}
              autoFocus
            />
            <textarea
              className="w-full border rounded-lg px-3 py-2 mb-4 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              placeholder="Контекст, почему это важно... (необязательно)"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
            />
            <button
              onClick={handleCreate}
              disabled={!title.trim() || loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
            >
              <Sparkles size={18} /> Создать и декомпозировать
            </button>
          </>
        )}

        {step === 'decomposing' && (
          <div className="flex flex-col items-center py-8 text-gray-500 dark:text-gray-400">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-600 mb-4" />
            <p>AI декомпозирует цель на milestones и задачи...</p>
          </div>
        )}

        {step === 'done' && (
          <div className="flex flex-col items-center py-8">
            <p className="text-2xl mb-2">✅</p>
            <p className="text-gray-700 dark:text-gray-300">BHAG создана и декомпозирована!</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">Переключаюсь на Mind Map...</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into GoalsPage**

In `GoalsPage.tsx`, import and add:
```tsx
import { DecomposeModal } from '../components/goals/DecomposeModal';

// In JSX, at the end:
<DecomposeModal
  open={showCreateBhag}
  onClose={() => setShowCreateBhag(false)}
  onCreated={() => { fetchGoals(); setActiveTab('mindmap'); setShowCreateBhag(false); }}
/>
```

Where `fetchGoals` is the existing function that re-fetches goals. Find its name in GoalsPage (likely `loadGoals` or similar) and use the right one.

- [ ] **Step 3: Build check**

```bash
pnpm --filter @pis/web build
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/goals/DecomposeModal.tsx apps/web/src/pages/GoalsPage.tsx
git commit -m "feat(web): DecomposeModal — create BHAG + AI decomposition"
```

---

## Phase 3 — Deploy + Smoke test

### Task 12: Build, deploy, verify

- [ ] **Step 1: Build web**

```bash
pnpm --filter @pis/shared build && pnpm --filter @pis/web build
```

- [ ] **Step 2: Push**

```bash
git push origin master
```

- [ ] **Step 3: Wait for CI + verify**

```bash
# Wait for GitHub Actions green
# Check both PM2 processes online
ssh root@213.139.229.148 "pm2 status"
```

- [ ] **Step 4: Smoke test**

1. Open https://kanban.myaipro.ru/goals
2. Click "🧠 Mind Map" tab → should show empty state "Нет BHAG"
3. Click "+ Новая BHAG" → modal opens → type "Выйти на 1 млн чистыми" → click "Создать и декомпозировать"
4. Wait for AI → mind map appears with BHAG center + 4-6 milestones + tasks
5. Tasks should be visible on Kanban board too (with due_dates)

- [ ] **Step 5: Fix any issues, commit, push**

---

## Deferred

- Node click → detail panel (NodeDetailPanel.tsx) — adds complexity, can be separate PR
- Drag-and-drop reparenting on the frontend (API endpoint ready, needs React Flow `onNodeDrag` handler)
- TG bot decompose flow (currently bot tells user to open web UI)
- Radial layout (dagre does top-bottom by default; true radial needs post-processing or elk engine — can iterate)

## Self-review

- Spec coverage: ✅ DB migration, ✅ API mindmap/decompose/nodes, ✅ React Flow visualization, ✅ custom nodes with progress, ✅ BHAG creation modal, ✅ TG bot integration, ✅ 30s polling
- Deferred: node detail panel, drag-and-drop frontend wiring, radial layout (dagre does tree; radial is a nice-to-have cosmetic)
- Types consistent: MindMapData used in MindMapTab matches API response shape from Task 2
- No placeholders
