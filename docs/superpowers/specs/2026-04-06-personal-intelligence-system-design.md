# Personal Intelligence System (PIS) — Design Spec
**Date:** 2026-04-06
**Phase:** 1

---

## Overview

A personal life and project management app with Obsidian as the source of truth. SQLite is an index/cache only — always rebuildable from the vault. Designed for long-term active development; extensibility and modularity are the highest priority.

---

## Architecture

### Monorepo Structure (pnpm workspaces)

```
personal-intelligence-system/
├── apps/
│   └── web/                    # React 18 + Vite + TypeScript
├── packages/
│   ├── api/                    # Node.js + Express + TypeScript
│   └── shared/                 # Shared TypeScript types
└── vault/                      # Points to C:\Users\smolentsev\Documents\ObsidianVault
```

### Core Principles

1. **Extensibility first** — interfaces over concrete implementations, versioned APIs (/v1/), SOLID principles, no hardcoded values
2. **Obsidian as source of truth** — all data in Markdown + YAML frontmatter; SQLite is index only; never delete, use `archived: true`
3. **File ingestion pipeline** — any file type → Parse → Extract Text → Claude Structure → Markdown → Obsidian

---

## Data Layer

### SQLite Schema (packages/api/src/db/schema.sql)

- **projects** — id, name, description, status, color, vault_path, created_at, updated_at, archived
- **tasks** — id, project_id, title, description, status (backlog|todo|in_progress|done), priority (1-5), urgency (1-5), due_date, start_date, vault_path, created_at, updated_at, archived, order_index
- **people** — id, name, company, role, telegram, email, phone, notes, vault_path, created_at, updated_at
- **meetings** — id, title, date, project_id, summary_raw, summary_structured, vault_path, source_file, processed, created_at
- **agreements** — id, meeting_id, task_id, person_id, description, due_date, status (open|done|cancelled), created_at
- **ideas** — id, title, body, category (business|product|personal|growth), project_id, source_meeting_id, vault_path, created_at
- **inbox_items** — id, original_filename, original_path, file_type, extracted_text, processed, target_type (meeting|idea|task|material|unknown), target_id, created_at, error
- **task_people** — task_id, person_id
- **meeting_people** — meeting_id, person_id

Seed data: 3 sample projects, 5 sample tasks, 2 people.

### Obsidian Vault Rules

File naming:
- Meetings: `YYYY-MM-DD-slug-title.md`
- Tasks: `task-YYYYMMDD-HHmmss-slug.md`
- People: `Firstname-Lastname.md`
- Ideas: `YYYY-MM-DD-idea-slug.md`
- Inbox: `inbox-YYYYMMDD-HHmmss-originalname.md`

YAML frontmatter templates per type: meeting, task, person, idea (as specified in TZ).
Always use `[[WikiLinks]]` for cross-references. UTF-8 everywhere.

---

## Service Layer (packages/api/src/services/)

### obsidian.service.ts
All vault read/write operations. Enforces frontmatter templates, file naming rules, WikiLink formatting. Single point of contact with the filesystem.

### claude.service.ts
Clean abstraction over `@anthropic-ai/sdk`:

```typescript
interface ClaudeService {
  chat(messages, systemPrompt): Promise<string>
  parseMeeting(rawText): Promise<MeetingStructured>
  parseInboxItem(text, fileType): Promise<InboxAnalysis>
  suggestTasks(projectContext): Promise<TaskSuggestion[]>
  searchKnowledge(query, vaultContext): Promise<SearchResult>
  dailyBrief(tasksContext, meetingsContext): Promise<string>
}
```

System prompt includes: vault structure overview, current date, language instruction (respond in same language as input), WikiLinks instruction.

### ingest.service.ts
Pipeline (Phase 1 supports .txt, .md, .pdf):
1. **Receive** — file upload or text paste via POST /v1/ingest
2. **Detect** — identify file type
3. **Extract** — txt/md: read as-is; pdf: pdf-parse; docx: mammoth; images: Claude Vision; audio: Whisper API; URL: fetch + extract
4. **Claude Analysis** — returns JSON: detected_type, title, date, people, project_hints, agreements, tasks, ideas, summary, key_facts, tags
5. **Create Records** — DB records + vault files based on detected_type
6. **Return** — summary of what was created with links

---

## API Routes (packages/api — versioned under /v1/)

```
POST   /v1/ingest
GET    /v1/ingest/status/:id

GET    /v1/projects
POST   /v1/projects
GET    /v1/projects/:id
PATCH  /v1/projects/:id

GET    /v1/tasks               # ?project=&status=&person=
POST   /v1/tasks
PATCH  /v1/tasks/:id
PATCH  /v1/tasks/:id/move      # {status, order_index}
DELETE /v1/tasks/:id           # soft delete (archived=true)

GET    /v1/meetings            # ?project=&person=&from=&to=
POST   /v1/meetings
GET    /v1/meetings/:id

GET    /v1/people
POST   /v1/people
GET    /v1/people/:id/history

POST   /v1/ai/chat
POST   /v1/ai/daily-brief
GET    /v1/search?q=
```

All responses: `{ success: boolean, data?: T, error?: string, meta?: object }`

---

## Frontend (apps/web)

**Stack:** React 18, Vite, TypeScript, Tailwind CSS, @dnd-kit/core, Zustand, react-router-dom, axios

### Pages & Routes

| Route | Page | Description |
|-------|------|-------------|
| `/` | KanbanPage | Main kanban board |
| `/timeline` | TimelinePage | Time-based task view |
| `/projects` | ProjectsPage | Project list |
| `/meetings` | MeetingsPage | Meetings list |
| `/people` | PeoplePage | People list |
| `/inbox` | InboxPage | Ingestion inbox |

### KanbanBoard

- 4 columns: Backlog | To Do | In Progress | Done
- Swimlanes grouped by project
- Drag & drop between columns via `@dnd-kit/core`
- TaskCard shows: title, project badge (colored), priority + urgency indicators, due date (red if overdue), linked people avatars (initials), agreement count
- Click card → slide-out detail panel
- Extensible filter system via `FilterConfig[]` config array — Phase 1 filters: project, person, due date, archived. New filters added by appending to config, no component changes.
- Quick add task button per column

### TimelinePage

- Tabs: **Today | This Week | This Month | This Year**
- Tasks grouped by time slice based on `due_date`
- Tasks without `due_date` shown in "No due date" group
- Reuses same TaskCard component as KanbanBoard

### Other Components

- `FileIngestion.tsx` — drag-drop upload zone for ingest pipeline
- `ClaudeChat.tsx` — sidebar panel for AI chat

---

## Environment Config (.env.example)

```
ANTHROPIC_API_KEY=
VAULT_PATH=C:\Users\smolentsev\Documents\ObsidianVault
DATABASE_PATH=./data/pis.db
PORT=3001
NODE_ENV=development
OPENAI_API_KEY=
MAX_FILE_SIZE_MB=50
```

---

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| Backend | Node.js, Express, TypeScript, better-sqlite3, multer, pdf-parse, mammoth, @anthropic-ai/sdk, zod |
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, @dnd-kit/core, Zustand, react-router-dom, axios |
| Storage | SQLite (index), Obsidian Vault / Markdown (source of truth) |

---

## Phase 1 Build Order

1. Initialize monorepo with pnpm workspaces
2. Set up `packages/shared` — all TypeScript types
3. Set up `packages/api` — Express, SQLite schema + seed, services, all routes
4. Set up `apps/web` — Vite, routing, Zustand, API client, KanbanBoard, TimelinePage, FileIngestion, ClaudeChat
5. Configure `vault/` pointing to existing ObsidianVault
6. Write root `README.md` — architecture, how to run, how to extend, vault rules, future phases roadmap

---

## Future Phases (TODO hooks in code)

- Phase 2: image parser (Claude Vision), audio parser (Whisper), URL ingestion
- Phase 2: docx parser (mammoth)
- Phase 2: full-text search across vault
- Phase 3: mobile app, notifications, integrations
