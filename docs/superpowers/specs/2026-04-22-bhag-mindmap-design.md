# BHAG Mind Map — Design

**Date:** 2026-04-22
**Status:** Approved

## Purpose

A new page in the web app (Goals → Mind Map tab) that visualizes the user's Big Hairy Audacious Goal as a radial mind map. BHAG sits in the center; milestones branch outward; tasks and meetings hang off each milestone. Progress is tracked live with color coding. Users can create BHAGs via TG bot (voice/text) or web UI, and Claude AI handles the decomposition.

## Key Decisions

| Decision | Choice |
|---|---|
| Location | Web app only (Goals page, new "Mind Map" tab) |
| Visual style | Radial mind map (BHAG center, branches outward) |
| Input method | Both: TG bot (quick) + web UI (fine-tune with drag-and-drop) |
| Task integration | AI auto-links: creates real tasks/meetings with due_dates, deduplicates against existing |
| Progress tracking | Live: % per milestone (done/total tasks), color per node (green/yellow/gray), overall BHAG % |
| Library | @xyflow/react (React Flow) with dagre/elk layout engine |

## Architecture

```
┌─ Web UI ──────────────────────┐
│ GoalsPage.tsx → MindMapTab    │
│ @xyflow/react (radial layout) │
│ Custom nodes: BHAG/Milestone/ │
│   Task with progress bars     │
│ Colors: green/yellow/gray     │
│ Drag-and-drop + zoom/pan     │
└───────────┬───────────────────┘
            │ REST API
┌───────────▼───────────────────┐
│ GET  /goals/:id/mindmap       │ → tree of nodes + edges + progress
│ POST /goals/:id/decompose     │ → Claude decomposes BHAG → milestones → tasks
│ PATCH /goals/:id/nodes        │ → reorder/reparent nodes
│ POST /goals (type=bhag)       │ → create new BHAG
└───────────┬───────────────────┘
            │
┌───────────▼───────────────────┐
│ goals (type: bhag|milestone|  │
│   goal|key_result)            │
│ tasks (goal_id FK → goals.id) │
│ meetings (goal_id FK)         │
└───────────────────────────────┘
```

## Data Model

### Existing `goals` table — extend `type` values

Current types: `goal`, `key_result`. Add: `bhag`, `milestone`.

- `bhag` = the big goal (1 per year typically, but no hard limit)
- `milestone` = a checkpoint on the way to BHAG, `parent_id` → BHAG's goal.id
- Milestones can have `target_value`/`current_value`/`unit` for quantitative tracking
- `due_date` on milestones for timeline placement

### New column `goal_id` on `tasks` table

```sql
ALTER TABLE tasks ADD COLUMN goal_id INTEGER REFERENCES goals(id);
```

Links a task to its parent milestone (or directly to a BHAG). When task status changes → milestone progress recalculates.

### New column `goal_id` on `meetings` table

```sql
ALTER TABLE meetings ADD COLUMN goal_id INTEGER REFERENCES goals(id);
```

Links a meeting to a milestone (e.g., "meet investor" milestone has 3 meetings).

### No changes to `goals` schema itself

`parent_id` already handles BHAG → milestone hierarchy. `type` is TEXT, adding new values is schemaless.

## API Endpoints

### `GET /goals/:id/mindmap`

Returns the full tree for a BHAG:

```json
{
  "bhag": { "id": 5, "title": "Выйти на 1 млн чистыми", "progress": 35 },
  "nodes": [
    {
      "id": "goal-5", "type": "bhag", "label": "1 млн чистыми",
      "progress": 35, "status": "in_progress"
    },
    {
      "id": "goal-10", "type": "milestone", "label": "Запустить V-Cards",
      "progress": 60, "status": "in_progress", "parent": "goal-5",
      "due_date": "2026-06-30"
    },
    {
      "id": "task-42", "type": "task", "label": "Лендинг V-Cards",
      "status": "done", "parent": "goal-10"
    },
    {
      "id": "task-43", "type": "task", "label": "Интеграция SBP",
      "status": "todo", "parent": "goal-10"
    },
    {
      "id": "meeting-20", "type": "meeting", "label": "Встреча с инвестором",
      "status": "done", "parent": "goal-10"
    }
  ],
  "edges": [
    { "source": "goal-5", "target": "goal-10" },
    { "source": "goal-10", "target": "task-42" },
    { "source": "goal-10", "target": "task-43" },
    { "source": "goal-10", "target": "meeting-20" }
  ]
}
```

Progress calculation:
- Task node: `status === 'done'` → 100%, else 0%
- Meeting node: `processed === 1` (has transcript) → 100%, else 0%
- Milestone: average of children's progress
- BHAG: average of milestones' progress

Status → color mapping:
- `done` (progress === 100) → green `#22c55e`
- `in_progress` (0 < progress < 100) → yellow `#eab308`
- `not_started` (progress === 0) → gray `#6b7280`

### `POST /goals/:id/decompose`

Body: `{ "text": "user's description or voice transcript" }`

Claude decomposes into milestones + tasks. Returns proposed tree (same shape as mindmap response) for preview before saving. Uses `gpt-4.1` for quality decomposition.

Prompt instructs Claude to:
- Create 4-6 milestones with realistic due_dates spread across the year
- Each milestone: 3-5 concrete tasks
- Identify meetings needed (e.g., "meet X person", "pitch to investors")
- Match tasks/meetings to existing projects when possible
- Check for duplicate tasks (fuzzy match against user's existing tasks)

### `PATCH /goals/:id/nodes`

Body: `{ "moves": [{ "nodeId": "task-42", "newParent": "goal-11" }] }`

Reparent nodes via drag-and-drop. Updates `goal_id` on tasks/meetings or `parent_id` on milestones.

### `POST /goals` (existing, extend)

Body now accepts `type: "bhag"`. After creation, optionally auto-triggers decompose.

## Frontend Components

### File structure (new files)

```
apps/web/src/
  components/goals/
    MindMapTab.tsx          — main tab container, fetches data, renders ReactFlow
    MindMapNode.tsx         — custom node component (icon + title + progress bar + color)
    MindMapControls.tsx     — zoom controls, legend, "Add milestone" button
    DecomposeModal.tsx      — modal for creating BHAG + AI decomposition preview
    NodeDetailPanel.tsx     — slide-out panel when clicking a node (task details, status change)
  pages/
    GoalsPage.tsx           — modify: add "Mind Map" tab alongside existing goals list
```

### MindMapNode design

Each node is a rounded card (~180×60px):
```
┌──────────────────────┐
│ 🎯 Запустить V-Cards │
│ ████████░░ 60%       │
└──────────────────────┘
```

- BHAG node: larger (220×80), bold, centered
- Milestone node: medium, shows % progress bar
- Task node: smaller, shows status icon (✅/🔵/⚪)
- Meeting node: smaller, 🤝 icon + date

### DecomposeModal flow

1. User clicks "+ BHAG" → modal opens
2. Text area: "Опиши свою большую цель на год"
3. "Декомпозировать" button → calls POST /goals/:id/decompose → loading spinner
4. Preview: mini mind map inside modal showing proposed structure
5. User can delete/edit nodes in preview
6. "Сохранить" → creates all goals/tasks/meetings in DB
7. Modal closes, full mind map renders

### TG Bot integration

In `executeCommand` system prompt, add BHAG instructions:

```
BHAG (Большая Дерзкая Цель):
Когда пользователь ставит BHAG ("моя цель на год...", "хочу достичь...", "главная цель..."):
1. Создай goal type="bhag" через action: {"type": "create_goal", "title": "...", "goal_type": "bhag", "due_date": "YYYY-12-31"}
2. Предложи 4-6 milestones с датами
3. Для каждого milestone — 3-5 задач
4. Создай всё через серию actions
5. Скажи пользователю открыть Mind Map в приложении для визуализации
```

## Reactivity

When a task is marked done (via Kanban board, TG bot, or any other path):
- Mind map page auto-refreshes progress (polling every 30s or via WebSocket if available)
- Milestone progress bar updates
- Node color may change (gray → yellow on first task done; yellow → green when all done)

Currently the app doesn't have WebSocket. Use polling: `setInterval(fetchMindmapData, 30000)` on the mind map page.

## Dependencies

New npm packages for `apps/web`:
- `@xyflow/react` — React Flow v12+ (mind map rendering, pan/zoom, drag-and-drop)
- `dagre` — graph layout algorithm (positions nodes automatically in radial/tree layout)

No new API dependencies.

## Migration

```sql
ALTER TABLE tasks ADD COLUMN goal_id INTEGER REFERENCES goals(id);
ALTER TABLE meetings ADD COLUMN goal_id INTEGER REFERENCES goals(id);
```

Run on startup in `db.ts` migration section (same pattern as existing ALTERs — try/catch to handle column-already-exists).

## Multi-user

All queries scoped by `user_id`. Each user sees only their BHAGs. Goals table already has `user_id` column.

## Security

- API endpoints behind `requireAuth` middleware (existing)
- `goal_id` assignment validated: task/meeting must belong to same user_id as the goal
- Decompose endpoint rate-limited by Claude API cost (gpt-4.1 call per decomposition)

## Success Criteria

1. User says in TG: "Моя цель на год — выйти на 1 млн чистыми". Bot creates BHAG + 5 milestones + 15-20 tasks. Mind map appears at kanban.myaipro.ru/goals with radial layout.
2. User opens mind map in browser, sees BHAG in center, milestones around it, tasks/meetings branching out. Progress bars show live status.
3. User marks a task as done on Kanban board → mind map progress updates within 30s.
4. User drags a task from one milestone to another on the mind map → DB updated.
5. User clicks "+ BHAG" in web UI → types goal → Claude decomposes → preview → save.

## Risks

- **React Flow learning curve.** Mitigated: well-documented, many examples. Custom nodes are straightforward.
- **Radial layout with dagre.** Dagre does tree layout natively. True radial needs post-processing (convert tree coordinates to polar). Alternative: use `elk` layout engine which has radial options.
- **Large maps (>50 nodes).** React Flow handles hundreds of nodes. Performance not a concern.
- **Claude decomposition quality.** May propose unrealistic milestones. Mitigated: user reviews before saving (preview modal + TG card confirmation).
