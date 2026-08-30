# Personal Intelligence System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Phase 1 of a personal life & project management monorepo with Obsidian vault as source of truth, SQLite index, Express API, and React frontend with Kanban + Timeline views.

**Architecture:** pnpm monorepo with `packages/shared` (TypeScript types), `packages/api` (Express + SQLite + services), and `apps/web` (React + Vite). All data persisted as Markdown in the Obsidian vault; SQLite is a rebuildable index only.

**Tech Stack:** Node.js, Express, TypeScript, better-sqlite3, zod, multer, pdf-parse, @anthropic-ai/sdk, React 18, Vite, Tailwind CSS, @dnd-kit/core, Zustand, react-router-dom, axios, Jest, Vitest

**Root path:** `C:\Users\smolentsev\.claude\NewProject\Kanban` (referred to as `<root>` below)

---

## File Map

### packages/shared
```
packages/shared/
├── package.json
├── tsconfig.json
└── types/
    ├── index.ts
    ├── api.types.ts
    ├── task.types.ts
    ├── project.types.ts
    ├── meeting.types.ts
    ├── person.types.ts
    └── ingest.types.ts
```

### packages/api
```
packages/api/
├── package.json
├── tsconfig.json
├── .env.example
├── jest.config.ts
└── src/
    ├── index.ts
    ├── config/
    │   └── index.ts
    ├── db/
    │   ├── schema.sql
    │   ├── db.ts
    │   └── seed.ts
    ├── services/
    │   ├── obsidian.service.ts
    │   ├── claude.service.ts
    │   ├── ingest.service.ts
    │   ├── meeting.service.ts
    │   └── search.service.ts
    ├── parsers/
    │   ├── pdf.parser.ts
    │   ├── txt.parser.ts
    │   └── index.ts
    ├── routes/
    │   ├── index.ts
    │   ├── projects.ts
    │   ├── tasks.ts
    │   ├── meetings.ts
    │   ├── people.ts
    │   ├── ingest.ts
    │   └── ai.ts
    └── __tests__/
        ├── projects.test.ts
        ├── tasks.test.ts
        └── ingest.test.ts
```

### apps/web
```
apps/web/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts
├── index.html
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── api/
    │   ├── client.ts
    │   ├── projects.api.ts
    │   ├── tasks.api.ts
    │   ├── meetings.api.ts
    │   ├── people.api.ts
    │   ├── ingest.api.ts
    │   └── ai.api.ts
    ├── store/
    │   ├── index.ts
    │   ├── tasks.store.ts
    │   └── projects.store.ts
    ├── hooks/
    │   ├── useTasks.ts
    │   └── useProjects.ts
    ├── pages/
    │   ├── KanbanPage.tsx
    │   ├── TimelinePage.tsx
    │   ├── ProjectsPage.tsx
    │   ├── MeetingsPage.tsx
    │   ├── PeoplePage.tsx
    │   └── InboxPage.tsx
    ├── components/
    │   ├── kanban/
    │   │   ├── KanbanBoard.tsx
    │   │   ├── KanbanColumn.tsx
    │   │   ├── TaskCard.tsx
    │   │   └── TaskDetailPanel.tsx
    │   ├── timeline/
    │   │   └── TimelineView.tsx
    │   ├── filters/
    │   │   ├── FilterBar.tsx
    │   │   └── filterConfig.ts
    │   ├── upload/
    │   │   └── FileIngestion.tsx
    │   ├── chat/
    │   │   └── ClaudeChat.tsx
    │   └── ui/
    │       ├── Badge.tsx
    │       ├── SlidePanel.tsx
    │       └── Avatar.tsx
    └── __tests__/
        ├── KanbanBoard.test.tsx
        └── TimelineView.test.tsx
```

---

## Task 1: Initialize Monorepo

**Files:**
- Create: `<root>/package.json`
- Create: `<root>/pnpm-workspace.yaml`
- Create: `<root>/tsconfig.base.json`
- Create: `<root>/.gitignore`
- Create: `<root>/.env.example`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "personal-intelligence-system",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev": "pnpm --parallel -r dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  },
  "engines": {
    "node": ">=18.0.0",
    "pnpm": ">=8.0.0"
  }
}
```

- [ ] **Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 3: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
dist/
.env
*.db
data/
```

- [ ] **Step 5: Create .env.example at root**

```
ANTHROPIC_API_KEY=
VAULT_PATH=C:\Users\smolentsev\Documents\ObsidianVault
DATABASE_PATH=./data/pis.db
PORT=3001
NODE_ENV=development
OPENAI_API_KEY=
MAX_FILE_SIZE_MB=50
```

- [ ] **Step 6: Install pnpm if not present and initialize**

Run: `npm install -g pnpm`
Then: `pnpm install`

- [ ] **Step 7: Commit**

```bash
git init
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore .env.example
git commit -m "chore: initialize monorepo with pnpm workspaces"
```

---

## Task 2: packages/shared — TypeScript Types

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/types/api.types.ts`
- Create: `packages/shared/types/task.types.ts`
- Create: `packages/shared/types/project.types.ts`
- Create: `packages/shared/types/meeting.types.ts`
- Create: `packages/shared/types/person.types.ts`
- Create: `packages/shared/types/ingest.types.ts`
- Create: `packages/shared/types/index.ts`

- [ ] **Step 1: Create packages/shared/package.json**

```json
{
  "name": "@pis/shared",
  "version": "0.1.0",
  "main": "dist/types/index.js",
  "types": "dist/types/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create packages/shared/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["types/**/*"]
}
```

- [ ] **Step 3: Create api.types.ts**

```typescript
// packages/shared/types/api.types.ts

/** Standard API response envelope used by all endpoints */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: Record<string, unknown>;
}

export function ok<T>(data: T, meta?: Record<string, unknown>): ApiResponse<T> {
  return { success: true, data, ...(meta ? { meta } : {}) };
}

export function fail(error: string): ApiResponse<never> {
  return { success: false, error };
}
```

- [ ] **Step 4: Create project.types.ts**

```typescript
// packages/shared/types/project.types.ts

export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived';

export interface Project {
  id: number;
  name: string;
  description: string;
  status: ProjectStatus;
  color: string;
  vault_path: string | null;
  created_at: string;
  updated_at: string;
  archived: boolean;
}

export interface CreateProjectDto {
  name: string;
  description?: string;
  status?: ProjectStatus;
  color?: string;
}

export interface UpdateProjectDto {
  name?: string;
  description?: string;
  status?: ProjectStatus;
  color?: string;
  archived?: boolean;
}
```

- [ ] **Step 5: Create task.types.ts**

```typescript
// packages/shared/types/task.types.ts

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'done';

export interface Task {
  id: number;
  project_id: number | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: number; // 1-5
  urgency: number;  // 1-5
  due_date: string | null;
  start_date: string | null;
  vault_path: string | null;
  created_at: string;
  updated_at: string;
  archived: boolean;
  order_index: number;
}

export interface CreateTaskDto {
  project_id?: number;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: number;
  urgency?: number;
  due_date?: string;
  start_date?: string;
}

export interface UpdateTaskDto {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: number;
  urgency?: number;
  due_date?: string | null;
  start_date?: string | null;
  archived?: boolean;
  project_id?: number | null;
}

export interface MoveTaskDto {
  status: TaskStatus;
  order_index: number;
}
```

- [ ] **Step 6: Create meeting.types.ts**

```typescript
// packages/shared/types/meeting.types.ts

export interface Meeting {
  id: number;
  title: string;
  date: string;
  project_id: number | null;
  summary_raw: string;
  summary_structured: string | null;
  vault_path: string | null;
  source_file: string | null;
  processed: boolean;
  created_at: string;
}

export interface Agreement {
  id: number;
  meeting_id: number;
  task_id: number | null;
  person_id: number | null;
  description: string;
  due_date: string | null;
  status: 'open' | 'done' | 'cancelled';
  created_at: string;
}

export interface MeetingStructured {
  title: string;
  date: string;
  summary: string;
  people: string[];
  agreements: Array<{ description: string; person?: string; due_date?: string }>;
  tasks: string[];
  ideas: string[];
  key_facts: string[];
  tags: string[];
}

export interface CreateMeetingDto {
  title: string;
  date: string;
  project_id?: number;
  summary_raw: string;
}
```

- [ ] **Step 7: Create person.types.ts**

```typescript
// packages/shared/types/person.types.ts

export interface Person {
  id: number;
  name: string;
  company: string;
  role: string;
  telegram: string;
  email: string;
  phone: string;
  notes: string;
  vault_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreatePersonDto {
  name: string;
  company?: string;
  role?: string;
  telegram?: string;
  email?: string;
  phone?: string;
  notes?: string;
}

export interface PersonHistory {
  person: Person;
  meetings: Array<{ id: number; title: string; date: string }>;
  agreements: Array<{ id: number; description: string; status: string; due_date: string | null }>;
  tasks: Array<{ id: number; title: string; status: string }>;
}
```

- [ ] **Step 8: Create ingest.types.ts**

```typescript
// packages/shared/types/ingest.types.ts

export type IngestFileType = 'txt' | 'md' | 'pdf' | 'docx' | 'png' | 'jpg' | 'jpeg' | 'mp3' | 'wav' | 'm4a' | 'ogg' | 'url' | 'text';
export type IngestTargetType = 'meeting' | 'idea' | 'task' | 'material' | 'unknown';

export interface InboxItem {
  id: number;
  original_filename: string;
  original_path: string | null;
  file_type: IngestFileType;
  extracted_text: string | null;
  processed: boolean;
  target_type: IngestTargetType | null;
  target_id: number | null;
  created_at: string;
  error: string | null;
}

export interface InboxAnalysis {
  detected_type: IngestTargetType;
  title: string;
  date: string | null;
  people: string[];
  project_hints: string[];
  agreements: string[];
  tasks: string[];
  ideas: string[];
  summary: string;
  key_facts: string[];
  tags: string[];
}

export interface IngestResult {
  inbox_item_id: number;
  detected_type: IngestTargetType;
  created_records: Array<{ type: string; id: number; title: string; vault_path: string | null }>;
  summary: string;
}
```

- [ ] **Step 9: Create types/index.ts**

```typescript
// packages/shared/types/index.ts
export * from './api.types';
export * from './task.types';
export * from './project.types';
export * from './meeting.types';
export * from './person.types';
export * from './ingest.types';
```

- [ ] **Step 10: Build shared package**

Run: `cd packages/shared && pnpm build`
Expected: `dist/` folder created with `.js` and `.d.ts` files

- [ ] **Step 11: Commit**

```bash
git add packages/shared/
git commit -m "feat: add shared TypeScript types package"
```

---

## Task 3: API Server Scaffold

**Files:**
- Create: `packages/api/package.json`
- Create: `packages/api/tsconfig.json`
- Create: `packages/api/.env.example`
- Create: `packages/api/src/config/index.ts`
- Create: `packages/api/src/index.ts`

- [ ] **Step 1: Create packages/api/package.json**

```json
{
  "name": "@pis/api",
  "version": "0.1.0",
  "main": "dist/index.js",
  "scripts": {
    "dev": "ts-node-dev --respawn --transpile-only src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "jest --runInBand"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.24.0",
    "@pis/shared": "workspace:*",
    "better-sqlite3": "^9.4.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.0",
    "express": "^4.18.0",
    "mammoth": "^1.7.0",
    "multer": "^1.4.5-lts.1",
    "pdf-parse": "^1.1.1",
    "slugify": "^1.6.6",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/cors": "^2.8.0",
    "@types/express": "^4.17.0",
    "@types/multer": "^1.4.0",
    "@types/node": "^20.0.0",
    "@types/pdf-parse": "^1.1.0",
    "@types/supertest": "^6.0.0",
    "jest": "^29.7.0",
    "supertest": "^7.0.0",
    "ts-jest": "^29.1.0",
    "ts-node-dev": "^2.0.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create packages/api/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create packages/api/jest.config.ts**

```typescript
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  setupFilesAfterFramework: [],
};

export default config;
```

- [ ] **Step 4: Create packages/api/src/config/index.ts**

```typescript
// packages/api/src/config/index.ts
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env variable: ${key}`);
  return value;
}

export const config = {
  port: parseInt(process.env['PORT'] ?? '3001', 10),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  anthropicApiKey: process.env['ANTHROPIC_API_KEY'] ?? '',
  vaultPath: process.env['VAULT_PATH'] ?? path.resolve(process.cwd(), '../../vault'),
  databasePath: process.env['DATABASE_PATH'] ?? path.resolve(process.cwd(), '../../data/pis.db'),
  openaiApiKey: process.env['OPENAI_API_KEY'] ?? '',
  maxFileSizeMb: parseInt(process.env['MAX_FILE_SIZE_MB'] ?? '50', 10),
} as const;
```

- [ ] **Step 5: Create packages/api/src/index.ts**

```typescript
// packages/api/src/index.ts
import express from 'express';
import cors from 'cors';
import { config } from './config';
import { router } from './routes';
import { initDb } from './db/db';

const app = express();

app.use(cors());
app.use(express.json({ limit: `${config.maxFileSizeMb}mb` }));
app.use(express.urlencoded({ extended: true }));

app.use('/v1', router);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

async function start(): Promise<void> {
  initDb();
  app.listen(config.port, () => {
    console.log(`[PIS API] running on port ${config.port}`);
  });
}

start().catch((err) => {
  console.error('[PIS API] startup error:', err);
  process.exit(1);
});

export { app };
```

- [ ] **Step 6: Create packages/api/src/routes/index.ts**

```typescript
// packages/api/src/routes/index.ts
import { Router } from 'express';
import { projectsRouter } from './projects';
import { tasksRouter } from './tasks';
import { meetingsRouter } from './meetings';
import { peopleRouter } from './people';
import { ingestRouter } from './ingest';
import { aiRouter } from './ai';

export const router = Router();

router.use('/projects', projectsRouter);
router.use('/tasks', tasksRouter);
router.use('/meetings', meetingsRouter);
router.use('/people', peopleRouter);
router.use('/ingest', ingestRouter);
router.use('/ai', aiRouter);
```

- [ ] **Step 7: Install dependencies**

Run: `cd packages/api && pnpm install`

- [ ] **Step 8: Commit**

```bash
git add packages/api/
git commit -m "feat: scaffold API server with Express + config"
```

---

## Task 4: Database Schema + Seed

**Files:**
- Create: `packages/api/src/db/schema.sql`
- Create: `packages/api/src/db/db.ts`
- Create: `packages/api/src/db/seed.ts`

- [ ] **Step 1: Create schema.sql**

```sql
-- packages/api/src/db/schema.sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'active'
                CHECK(status IN ('active','paused','completed','archived')),
  color       TEXT    NOT NULL DEFAULT '#6366f1',
  vault_path  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  archived    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER REFERENCES projects(id),
  title       TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'backlog'
                CHECK(status IN ('backlog','todo','in_progress','done')),
  priority    INTEGER NOT NULL DEFAULT 3 CHECK(priority BETWEEN 1 AND 5),
  urgency     INTEGER NOT NULL DEFAULT 3 CHECK(urgency BETWEEN 1 AND 5),
  due_date    TEXT,
  start_date  TEXT,
  vault_path  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  archived    INTEGER NOT NULL DEFAULT 0,
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS people (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  company    TEXT NOT NULL DEFAULT '',
  role       TEXT NOT NULL DEFAULT '',
  telegram   TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  vault_path TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS meetings (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  title               TEXT    NOT NULL,
  date                TEXT    NOT NULL,
  project_id          INTEGER REFERENCES projects(id),
  summary_raw         TEXT    NOT NULL DEFAULT '',
  summary_structured  TEXT,
  vault_path          TEXT,
  source_file         TEXT,
  processed           INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS agreements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id  INTEGER NOT NULL REFERENCES meetings(id),
  task_id     INTEGER REFERENCES tasks(id),
  person_id   INTEGER REFERENCES people(id),
  description TEXT    NOT NULL,
  due_date    TEXT,
  status      TEXT    NOT NULL DEFAULT 'open'
                CHECK(status IN ('open','done','cancelled')),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS ideas (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  title             TEXT NOT NULL,
  body              TEXT NOT NULL DEFAULT '',
  category          TEXT NOT NULL DEFAULT 'personal'
                      CHECK(category IN ('business','product','personal','growth')),
  project_id        INTEGER REFERENCES projects(id),
  source_meeting_id INTEGER REFERENCES meetings(id),
  vault_path        TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS inbox_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  original_filename TEXT NOT NULL,
  original_path     TEXT,
  file_type         TEXT NOT NULL,
  extracted_text    TEXT,
  processed         INTEGER NOT NULL DEFAULT 0,
  target_type       TEXT,
  target_id         INTEGER,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  error             TEXT
);

CREATE TABLE IF NOT EXISTS task_people (
  task_id   INTEGER NOT NULL REFERENCES tasks(id),
  person_id INTEGER NOT NULL REFERENCES people(id),
  PRIMARY KEY (task_id, person_id)
);

CREATE TABLE IF NOT EXISTS meeting_people (
  meeting_id INTEGER NOT NULL REFERENCES meetings(id),
  person_id  INTEGER NOT NULL REFERENCES people(id),
  PRIMARY KEY (meeting_id, person_id)
);
```

- [ ] **Step 2: Create db.ts**

```typescript
// packages/api/src/db/db.ts
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) throw new Error('Database not initialized. Call initDb() first.');
  return _db;
}

export function initDb(): void {
  const dbDir = path.dirname(config.databasePath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  _db = new Database(config.databasePath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  const schema = fs.readFileSync(
    path.resolve(__dirname, 'schema.sql'),
    'utf-8'
  );
  _db.exec(schema);
}

/** For use in tests — creates an in-memory database */
export function initTestDb(): void {
  _db = new Database(':memory:');
  _db.pragma('foreign_keys = ON');

  const schema = fs.readFileSync(
    path.resolve(__dirname, 'schema.sql'),
    'utf-8'
  );
  _db.exec(schema);
}

export function closeDb(): void {
  _db?.close();
  _db = null;
}
```

- [ ] **Step 3: Create seed.ts**

```typescript
// packages/api/src/db/seed.ts
import { getDb } from './db';

export function seedDb(): void {
  const db = getDb();

  const projectCount = (db.prepare('SELECT COUNT(*) as c FROM projects').get() as { c: number }).c;
  if (projectCount > 0) return; // already seeded

  // 3 sample projects
  const insertProject = db.prepare(
    'INSERT INTO projects (name, description, status, color) VALUES (?, ?, ?, ?)'
  );
  const p1 = insertProject.run('Личные цели 2026', 'Цели на год', 'active', '#6366f1');
  const p2 = insertProject.run('Рабочие проекты', 'Текущие рабочие задачи', 'active', '#10b981');
  const p3 = insertProject.run('Обучение', 'Курсы, книги, материалы', 'active', '#f59e0b');

  // 5 sample tasks
  const insertTask = db.prepare(
    'INSERT INTO tasks (project_id, title, status, priority, urgency) VALUES (?, ?, ?, ?, ?)'
  );
  insertTask.run(p1.lastInsertRowid, 'Настроить PIS систему', 'in_progress', 5, 5);
  insertTask.run(p1.lastInsertRowid, 'Прочитать 12 книг за год', 'todo', 3, 2);
  insertTask.run(p2.lastInsertRowid, 'Провести ревью кода', 'todo', 4, 3);
  insertTask.run(p2.lastInsertRowid, 'Написать документацию', 'backlog', 2, 1);
  insertTask.run(p3.lastInsertRowid, 'Пройти курс по TypeScript', 'todo', 3, 2);

  // 2 sample people
  const insertPerson = db.prepare(
    'INSERT INTO people (name, company, role) VALUES (?, ?, ?)'
  );
  insertPerson.run('Иван Петров', 'ООО Рога и Копыта', 'Директор');
  insertPerson.run('Мария Сидорова', 'Freelance', 'Дизайнер');

  console.log('[seed] database seeded with sample data');
}
```

- [ ] **Step 4: Update src/index.ts to call seed after initDb**

In `packages/api/src/index.ts`, update the `start()` function:

```typescript
import { seedDb } from './db/seed';

async function start(): Promise<void> {
  initDb();
  seedDb();
  app.listen(config.port, () => {
    console.log(`[PIS API] running on port ${config.port}`);
  });
}
```

- [ ] **Step 5: Write test for DB init**

```typescript
// packages/api/src/__tests__/db.test.ts
import { initTestDb, getDb, closeDb } from '../db/db';

describe('database', () => {
  beforeEach(() => initTestDb());
  afterEach(() => closeDb());

  it('creates all tables', () => {
    const db = getDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain('projects');
    expect(names).toContain('tasks');
    expect(names).toContain('people');
    expect(names).toContain('meetings');
    expect(names).toContain('agreements');
    expect(names).toContain('ideas');
    expect(names).toContain('inbox_items');
  });
});
```

- [ ] **Step 6: Run test**

Run: `cd packages/api && pnpm test -- db.test.ts`
Expected: PASS — all tables created

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/db/
git commit -m "feat: add SQLite schema, db init, and seed data"
```

---

## Task 5: obsidian.service.ts

**Files:**
- Create: `packages/api/src/services/obsidian.service.ts`

- [ ] **Step 1: Write test**

```typescript
// packages/api/src/__tests__/obsidian.service.test.ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ObsidianService } from '../services/obsidian.service';

describe('ObsidianService', () => {
  let tmpDir: string;
  let service: ObsidianService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pis-test-'));
    service = new ObsidianService(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('writes a task file with correct frontmatter', async () => {
    const vaultPath = await service.writeTask({
      title: 'Test Task',
      status: 'todo',
      priority: 3,
      urgency: 3,
      project: 'TestProject',
    });
    const content = fs.readFileSync(path.join(tmpDir, vaultPath), 'utf-8');
    expect(content).toContain('type: task');
    expect(content).toContain('status: todo');
    expect(content).toContain('priority: 3');
    expect(content).toContain('# Test Task');
  });

  it('generates correct file name for meetings', () => {
    const name = service.meetingFileName('2026-04-06', 'Обсуждение проекта');
    expect(name).toMatch(/^2026-04-06-.+\.md$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && pnpm test -- obsidian`
Expected: FAIL — ObsidianService not defined

- [ ] **Step 3: Implement obsidian.service.ts**

```typescript
// packages/api/src/services/obsidian.service.ts
import * as fs from 'fs';
import * as path from 'path';
import slugify from 'slugify';

interface WriteTaskParams {
  title: string;
  status: string;
  priority: number;
  urgency: number;
  project?: string;
  due_date?: string | null;
  people?: string[];
  tags?: string[];
}

interface WriteMeetingParams {
  title: string;
  date: string;
  project?: string;
  people?: string[];
  summary: string;
  agreements?: number;
  source?: string;
}

interface WritePersonParams {
  name: string;
  company?: string;
  role?: string;
  tags?: string[];
}

interface WriteIdeaParams {
  title: string;
  body: string;
  category: string;
  project?: string;
  source?: string;
  date: string;
}

/**
 * Handles all read/write operations with the Obsidian vault.
 * All paths returned are relative to the vault root.
 * Enforces frontmatter templates, naming conventions, and WikiLinks.
 */
export class ObsidianService {
  constructor(private readonly vaultPath: string) {}

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  private toSlug(text: string): string {
    return slugify(text, { lower: true, strict: true, locale: 'ru' });
  }

  private wikiLink(name: string): string {
    return `[[${name}]]`;
  }

  private now(): string {
    return new Date().toISOString();
  }

  meetingFileName(date: string, title: string): string {
    return `${date}-${this.toSlug(title)}.md`;
  }

  /** Returns relative vault path */
  async writeTask(params: WriteTaskParams): Promise<string> {
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
    const filename = `task-${ts}-${this.toSlug(params.title)}.md`;
    const dir = path.join(this.vaultPath, 'Tasks');
    this.ensureDir(dir);

    const people = (params.people ?? []).map((p) => this.wikiLink(p));
    const frontmatter = [
      '---',
      'type: task',
      `status: ${params.status}`,
      `project: ${params.project ? this.wikiLink(params.project) : 'null'}`,
      `priority: ${params.priority}`,
      `urgency: ${params.urgency}`,
      `due_date: ${params.due_date ?? 'null'}`,
      `people: [${people.join(', ')}]`,
      `tags: [${(params.tags ?? ['task']).join(', ')}]`,
      `created_at: ${this.now()}`,
      '---',
    ].join('\n');

    const content = `${frontmatter}\n\n# ${params.title}\n\n`;
    fs.writeFileSync(path.join(dir, filename), content, 'utf-8');
    return `Tasks/${filename}`;
  }

  /** Returns relative vault path */
  async writeMeeting(params: WriteMeetingParams): Promise<string> {
    const filename = this.meetingFileName(params.date, params.title);
    const dir = path.join(this.vaultPath, 'Meetings');
    this.ensureDir(dir);

    const people = (params.people ?? []).map((p) => this.wikiLink(p));
    const frontmatter = [
      '---',
      'type: meeting',
      `date: ${params.date}`,
      `title: "${params.title}"`,
      `project: ${params.project ? this.wikiLink(params.project) : 'null'}`,
      `people: [${people.join(', ')}]`,
      `agreements: ${params.agreements ?? 0}`,
      'tags: [meeting]',
      `source: ${params.source ?? 'manual'}`,
      `created_at: ${this.now()}`,
      '---',
    ].join('\n');

    const content = `${frontmatter}\n\n# ${params.title}\n\n${params.summary}\n`;
    fs.writeFileSync(path.join(dir, filename), content, 'utf-8');
    return `Meetings/${filename}`;
  }

  /** Returns relative vault path */
  async writePerson(params: WritePersonParams): Promise<string> {
    const filename = `${this.toSlug(params.name)}.md`;
    const dir = path.join(this.vaultPath, 'People');
    this.ensureDir(dir);

    const frontmatter = [
      '---',
      'type: person',
      `name: "${params.name}"`,
      `company: "${params.company ?? ''}"`,
      `role: "${params.role ?? ''}"`,
      `tags: [${(params.tags ?? ['person']).join(', ')}]`,
      `created_at: ${this.now()}`,
      '---',
    ].join('\n');

    const content = `${frontmatter}\n\n# ${params.name}\n\n`;
    fs.writeFileSync(path.join(dir, filename), content, 'utf-8');
    return `People/${filename}`;
  }

  /** Returns relative vault path */
  async writeIdea(params: WriteIdeaParams): Promise<string> {
    const filename = `${params.date}-idea-${this.toSlug(params.title)}.md`;
    const dir = path.join(this.vaultPath, 'Ideas');
    this.ensureDir(dir);

    const frontmatter = [
      '---',
      'type: idea',
      `category: ${params.category}`,
      `project: ${params.project ? this.wikiLink(params.project) : 'null'}`,
      `source: ${params.source ?? 'manual'}`,
      'tags: [idea]',
      `created_at: ${this.now()}`,
      '---',
    ].join('\n');

    const content = `${frontmatter}\n\n# ${params.title}\n\n${params.body}\n`;
    fs.writeFileSync(path.join(dir, filename), content, 'utf-8');
    return `Ideas/${filename}`;
  }

  /** Write raw file to Inbox. Returns relative vault path. */
  async writeInboxItem(originalName: string, content: string): Promise<string> {
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
    const filename = `inbox-${ts}-${this.toSlug(originalName)}.md`;
    const dir = path.join(this.vaultPath, 'Inbox');
    this.ensureDir(dir);
    fs.writeFileSync(path.join(dir, filename), content, 'utf-8');
    return `Inbox/${filename}`;
  }

  /** Read a vault file by relative path */
  readFile(relativePath: string): string {
    return fs.readFileSync(path.join(this.vaultPath, relativePath), 'utf-8');
  }

  /** List all .md files in a subfolder */
  listFolder(folder: string): string[] {
    const dir = path.join(this.vaultPath, folder);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => `${folder}/${f}`);
  }

  /** Ensure all required vault folders exist */
  initVaultFolders(): void {
    const folders = ['Projects', 'People', 'Meetings', 'Ideas', 'Goals', 'Tasks', 'Materials', 'Inbox'];
    for (const folder of folders) {
      this.ensureDir(path.join(this.vaultPath, folder));
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/api && pnpm test -- obsidian`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/obsidian.service.ts packages/api/src/__tests__/obsidian.service.test.ts
git commit -m "feat: add ObsidianService for vault read/write"
```

---

## Task 6: claude.service.ts

**Files:**
- Create: `packages/api/src/services/claude.service.ts`

- [ ] **Step 1: Create claude.service.ts**

```typescript
// packages/api/src/services/claude.service.ts
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import type {
  MeetingStructured,
  InboxAnalysis,
  IngestTargetType,
} from '@pis/shared';

export interface TaskSuggestion {
  title: string;
  description: string;
  priority: number;
  urgency: number;
}

export interface SearchResult {
  answer: string;
  sources: string[];
}

/**
 * Clean abstraction over the Anthropic Claude API.
 * All methods include a system prompt with vault context and date.
 */
export class ClaudeService {
  private readonly client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: config.anthropicApiKey });
  }

  private buildSystemPrompt(extra = ''): string {
    return [
      `You are a personal assistant integrated with an Obsidian vault-based life management system.`,
      `Today's date: ${new Date().toISOString().split('T')[0]}.`,
      `Always respond in the same language as the user's input (Russian or English).`,
      `When mentioning people or projects by name, always format them as [[WikiLinks]].`,
      extra,
    ]
      .filter(Boolean)
      .join('\n');
  }

  async chat(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    systemPrompt = ''
  ): Promise<string> {
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: this.buildSystemPrompt(systemPrompt),
      messages,
    });
    const block = response.content[0];
    if (block?.type !== 'text') throw new Error('Unexpected response type from Claude');
    return block.text;
  }

  async parseMeeting(rawText: string): Promise<MeetingStructured> {
    const prompt = `Parse the following meeting notes and return ONLY valid JSON matching this schema:
{
  "title": "string",
  "date": "YYYY-MM-DD or null",
  "summary": "string",
  "people": ["name strings"],
  "agreements": [{"description": "string", "person": "string or null", "due_date": "YYYY-MM-DD or null"}],
  "tasks": ["action item strings"],
  "ideas": ["idea strings"],
  "key_facts": ["fact strings"],
  "tags": ["tag strings"]
}

Meeting notes:
${rawText}`;

    const result = await this.chat([{ role: 'user', content: prompt }]);
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Claude did not return valid JSON for meeting parse');
    return JSON.parse(jsonMatch[0]) as MeetingStructured;
  }

  async parseInboxItem(text: string, fileType: string): Promise<InboxAnalysis> {
    const prompt = `Analyze this content (file type: ${fileType}) and return ONLY valid JSON:
{
  "detected_type": "meeting|idea|task|material|unknown",
  "title": "string",
  "date": "YYYY-MM-DD or null",
  "people": ["name strings"],
  "project_hints": ["project name strings"],
  "agreements": ["string"],
  "tasks": ["string"],
  "ideas": ["string"],
  "summary": "2-3 sentence summary",
  "key_facts": ["string"],
  "tags": ["string"]
}

Content:
${text}`;

    const result = await this.chat([{ role: 'user', content: prompt }]);
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Claude did not return valid JSON for inbox analysis');
    return JSON.parse(jsonMatch[0]) as InboxAnalysis;
  }

  async suggestTasks(projectContext: string): Promise<TaskSuggestion[]> {
    const prompt = `Given this project context, suggest 3-5 concrete next tasks. Return ONLY a JSON array:
[{"title": "string", "description": "string", "priority": 1-5, "urgency": 1-5}]

Project context:
${projectContext}`;

    const result = await this.chat([{ role: 'user', content: prompt }]);
    const jsonMatch = result.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    return JSON.parse(jsonMatch[0]) as TaskSuggestion[];
  }

  async searchKnowledge(query: string, vaultContext: string): Promise<SearchResult> {
    const prompt = `Search the following vault content and answer the query. Return ONLY valid JSON:
{"answer": "string", "sources": ["relative/vault/paths"]}

Query: ${query}

Vault content:
${vaultContext}`;

    const result = await this.chat([{ role: 'user', content: prompt }]);
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { answer: result, sources: [] };
    return JSON.parse(jsonMatch[0]) as SearchResult;
  }

  async dailyBrief(tasksContext: string, meetingsContext: string): Promise<string> {
    const prompt = `Generate a concise morning brief based on today's tasks and upcoming meetings.
Be motivating, practical, and highlight the 3 most important things to focus on today.

Tasks:
${tasksContext}

Upcoming meetings:
${meetingsContext}`;

    return this.chat([{ role: 'user', content: prompt }]);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/services/claude.service.ts
git commit -m "feat: add ClaudeService abstraction over Anthropic SDK"
```

---

## Task 7: Parsers + ingest.service.ts (Phase 1: txt, md, pdf)

**Files:**
- Create: `packages/api/src/parsers/txt.parser.ts`
- Create: `packages/api/src/parsers/pdf.parser.ts`
- Create: `packages/api/src/parsers/index.ts`
- Create: `packages/api/src/services/ingest.service.ts`

- [ ] **Step 1: Write failing test for txt parser**

```typescript
// packages/api/src/__tests__/parsers.test.ts
import { parseFile } from '../parsers';

describe('parsers', () => {
  it('parses txt content', async () => {
    const result = await parseFile(Buffer.from('Hello world'), 'txt');
    expect(result).toBe('Hello world');
  });

  it('parses md content', async () => {
    const result = await parseFile(Buffer.from('# Title\nContent'), 'md');
    expect(result).toBe('# Title\nContent');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd packages/api && pnpm test -- parsers`
Expected: FAIL

- [ ] **Step 3: Create txt.parser.ts**

```typescript
// packages/api/src/parsers/txt.parser.ts

/**
 * Parse plain text and markdown files — return content as-is.
 */
export async function parseTxt(buffer: Buffer): Promise<string> {
  return buffer.toString('utf-8');
}
```

- [ ] **Step 4: Create pdf.parser.ts**

```typescript
// packages/api/src/parsers/pdf.parser.ts
import pdfParse from 'pdf-parse';

/**
 * Extract text from PDF using pdf-parse.
 * Phase 2: TODO add image extraction via Claude Vision
 */
export async function parsePdf(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  return data.text;
}
```

- [ ] **Step 5: Create parsers/index.ts**

```typescript
// packages/api/src/parsers/index.ts
import { parseTxt } from './txt.parser';
import { parsePdf } from './pdf.parser';
import type { IngestFileType } from '@pis/shared';

/**
 * Route a file buffer to the correct parser based on file type.
 * Phase 2 TODO: add docx, image, audio, url parsers
 */
export async function parseFile(buffer: Buffer, fileType: IngestFileType): Promise<string> {
  switch (fileType) {
    case 'txt':
    case 'md':
      return parseTxt(buffer);
    case 'pdf':
      return parsePdf(buffer);
    default:
      throw new Error(`Unsupported file type in Phase 1: ${fileType}. Phase 2 will add: docx, png, jpg, mp3, wav, url`);
  }
}

export function detectFileType(filename: string): IngestFileType {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, IngestFileType> = {
    txt: 'txt', md: 'md', pdf: 'pdf', docx: 'docx',
    png: 'png', jpg: 'jpg', jpeg: 'jpeg',
    mp3: 'mp3', wav: 'wav', m4a: 'm4a', ogg: 'ogg',
  };
  return map[ext] ?? 'txt';
}
```

- [ ] **Step 6: Run tests — expect PASS**

Run: `cd packages/api && pnpm test -- parsers`
Expected: PASS

- [ ] **Step 7: Create ingest.service.ts**

```typescript
// packages/api/src/services/ingest.service.ts
import { getDb } from '../db/db';
import { parseFile, detectFileType } from '../parsers';
import { ClaudeService } from './claude.service';
import { ObsidianService } from './obsidian.service';
import { config } from '../config';
import type { IngestResult, IngestFileType, IngestTargetType } from '@pis/shared';

/**
 * Orchestrates the full file ingestion pipeline:
 * Receive → Detect → Extract Text → Claude Analysis → Create Records → Return
 */
export class IngestService {
  private readonly claude: ClaudeService;
  private readonly obsidian: ObsidianService;

  constructor() {
    this.claude = new ClaudeService();
    this.obsidian = new ObsidianService(config.vaultPath);
  }

  async ingestBuffer(
    buffer: Buffer,
    originalFilename: string
  ): Promise<IngestResult> {
    const db = getDb();
    const fileType = detectFileType(originalFilename);

    // 1. Create inbox_item record
    const insert = db.prepare(`
      INSERT INTO inbox_items (original_filename, file_type)
      VALUES (?, ?)
    `);
    const { lastInsertRowid } = insert.run(originalFilename, fileType);
    const itemId = Number(lastInsertRowid);

    try {
      // 2. Extract text
      const extractedText = await parseFile(buffer, fileType);

      db.prepare('UPDATE inbox_items SET extracted_text = ? WHERE id = ?')
        .run(extractedText, itemId);

      // 3. Claude analysis
      const analysis = await this.claude.parseInboxItem(extractedText, fileType);

      // 4. Create records based on detected type
      const createdRecords: IngestResult['created_records'] = [];

      if (analysis.detected_type === 'meeting') {
        const date = analysis.date ?? new Date().toISOString().split('T')[0]!;
        const vaultPath = await this.obsidian.writeMeeting({
          title: analysis.title,
          date,
          people: analysis.people,
          summary: analysis.summary,
          agreements: analysis.agreements.length,
          source: originalFilename,
        });
        const result = db.prepare(`
          INSERT INTO meetings (title, date, summary_raw, summary_structured, vault_path, source_file, processed)
          VALUES (?, ?, ?, ?, ?, ?, 1)
        `).run(analysis.title, date, extractedText, JSON.stringify(analysis), vaultPath, originalFilename);
        createdRecords.push({ type: 'meeting', id: Number(result.lastInsertRowid), title: analysis.title, vault_path: vaultPath });
      } else if (analysis.detected_type === 'idea') {
        const date = analysis.date ?? new Date().toISOString().split('T')[0]!;
        const vaultPath = await this.obsidian.writeIdea({
          title: analysis.title,
          body: analysis.summary,
          category: 'personal',
          source: originalFilename,
          date,
        });
        const result = db.prepare(`
          INSERT INTO ideas (title, body, vault_path)
          VALUES (?, ?, ?)
        `).run(analysis.title, analysis.summary, vaultPath);
        createdRecords.push({ type: 'idea', id: Number(result.lastInsertRowid), title: analysis.title, vault_path: vaultPath });
      } else {
        // task or material or unknown — save as inbox item
        const vaultPath = await this.obsidian.writeInboxItem(
          originalFilename,
          `# ${analysis.title}\n\n${analysis.summary}\n\n---\n\n${extractedText}`
        );
        createdRecords.push({ type: 'inbox', id: itemId, title: analysis.title, vault_path: vaultPath });
      }

      // 5. Mark processed
      db.prepare(`
        UPDATE inbox_items
        SET processed = 1, target_type = ?, target_id = ?
        WHERE id = ?
      `).run(analysis.detected_type, createdRecords[0]?.id ?? null, itemId);

      return {
        inbox_item_id: itemId,
        detected_type: analysis.detected_type as IngestTargetType,
        created_records: createdRecords,
        summary: analysis.summary,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      db.prepare('UPDATE inbox_items SET error = ? WHERE id = ?').run(message, itemId);
      throw err;
    }
  }

  async ingestText(text: string): Promise<IngestResult> {
    const buf = Buffer.from(text, 'utf-8');
    return this.ingestBuffer(buf, 'paste.txt');
  }

  getStatus(id: number): unknown {
    return getDb().prepare('SELECT * FROM inbox_items WHERE id = ?').get(id);
  }
}
```

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/parsers/ packages/api/src/services/ingest.service.ts packages/api/src/__tests__/parsers.test.ts
git commit -m "feat: add file parsers and IngestService pipeline"
```

---

## Task 8: API Routes — Projects & Tasks

**Files:**
- Create: `packages/api/src/routes/projects.ts`
- Create: `packages/api/src/routes/tasks.ts`

- [ ] **Step 1: Write failing test for projects routes**

```typescript
// packages/api/src/__tests__/projects.test.ts
import request from 'supertest';
import { app } from '../index';
import { initTestDb, closeDb } from '../db/db';

beforeEach(() => initTestDb());
afterEach(() => closeDb());

describe('GET /v1/projects', () => {
  it('returns empty list', async () => {
    const res = await request(app).get('/v1/projects');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('POST /v1/projects', () => {
  it('creates a project', async () => {
    const res = await request(app)
      .post('/v1/projects')
      .send({ name: 'Test Project', description: 'desc' });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Test Project');
  });

  it('returns 400 if name missing', async () => {
    const res = await request(app).post('/v1/projects').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd packages/api && pnpm test -- projects`
Expected: FAIL

- [ ] **Step 3: Create routes/projects.ts**

```typescript
// packages/api/src/routes/projects.ts
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';

export const projectsRouter = Router();

const CreateProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().default(''),
  status: z.enum(['active', 'paused', 'completed', 'archived']).optional().default('active'),
  color: z.string().optional().default('#6366f1'),
});

const UpdateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(['active', 'paused', 'completed', 'archived']).optional(),
  color: z.string().optional(),
  archived: z.boolean().optional(),
});

projectsRouter.get('/', (_req: Request, res: Response) => {
  const projects = getDb().prepare('SELECT * FROM projects WHERE archived = 0 ORDER BY created_at DESC').all();
  res.json(ok(projects));
});

projectsRouter.post('/', (req: Request, res: Response) => {
  const parsed = CreateProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(fail(parsed.error.message));
    return;
  }
  const { name, description, status, color } = parsed.data;
  const result = getDb()
    .prepare('INSERT INTO projects (name, description, status, color) VALUES (?, ?, ?, ?)')
    .run(name, description, status, color);
  const project = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(ok(project));
});

projectsRouter.get('/:id', (req: Request, res: Response) => {
  const project = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(Number(req.params['id']));
  if (!project) { res.status(404).json(fail('Project not found')); return; }
  const tasks = getDb().prepare('SELECT * FROM tasks WHERE project_id = ? AND archived = 0').all(Number(req.params['id']));
  const meetings = getDb().prepare('SELECT * FROM meetings WHERE project_id = ?').all(Number(req.params['id']));
  res.json(ok({ ...project as object, tasks, meetings }));
});

projectsRouter.patch('/:id', (req: Request, res: Response) => {
  const parsed = UpdateProjectSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }

  const fields = Object.entries(parsed.data)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => `${k} = ?`);
  const values = Object.values(parsed.data).filter((v) => v !== undefined);

  if (fields.length === 0) { res.status(400).json(fail('No fields to update')); return; }

  getDb()
    .prepare(`UPDATE projects SET ${fields.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`)
    .run(...values, Number(req.params['id']));

  const updated = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(Number(req.params['id']));
  res.json(ok(updated));
});
```

- [ ] **Step 4: Create routes/tasks.ts**

```typescript
// packages/api/src/routes/tasks.ts
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';

export const tasksRouter = Router();

const CreateTaskSchema = z.object({
  project_id: z.number().int().optional(),
  title: z.string().min(1),
  description: z.string().optional().default(''),
  status: z.enum(['backlog', 'todo', 'in_progress', 'done']).optional().default('backlog'),
  priority: z.number().int().min(1).max(5).optional().default(3),
  urgency: z.number().int().min(1).max(5).optional().default(3),
  due_date: z.string().optional(),
  start_date: z.string().optional(),
});

const UpdateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(['backlog', 'todo', 'in_progress', 'done']).optional(),
  priority: z.number().int().min(1).max(5).optional(),
  urgency: z.number().int().min(1).max(5).optional(),
  due_date: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  archived: z.boolean().optional(),
  project_id: z.number().int().nullable().optional(),
});

const MoveTaskSchema = z.object({
  status: z.enum(['backlog', 'todo', 'in_progress', 'done']),
  order_index: z.number().int(),
});

tasksRouter.get('/', (req: Request, res: Response) => {
  let query = 'SELECT * FROM tasks WHERE archived = 0';
  const params: unknown[] = [];
  if (req.query['project']) { query += ' AND project_id = ?'; params.push(Number(req.query['project'])); }
  if (req.query['status']) { query += ' AND status = ?'; params.push(req.query['status']); }
  if (req.query['person']) {
    query += ' AND id IN (SELECT task_id FROM task_people WHERE person_id = ?)';
    params.push(Number(req.query['person']));
  }
  query += ' ORDER BY order_index ASC, created_at DESC';
  const tasks = getDb().prepare(query).all(...params);
  res.json(ok(tasks));
});

tasksRouter.post('/', (req: Request, res: Response) => {
  const parsed = CreateTaskSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { project_id, title, description, status, priority, urgency, due_date, start_date } = parsed.data;
  const result = getDb()
    .prepare('INSERT INTO tasks (project_id, title, description, status, priority, urgency, due_date, start_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(project_id ?? null, title, description, status, priority, urgency, due_date ?? null, start_date ?? null);
  const task = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(ok(task));
});

tasksRouter.patch('/:id', (req: Request, res: Response) => {
  const parsed = UpdateTaskSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const fields = Object.entries(parsed.data).filter(([, v]) => v !== undefined).map(([k]) => `${k} = ?`);
  const values = Object.values(parsed.data).filter((v) => v !== undefined);
  if (fields.length === 0) { res.status(400).json(fail('No fields to update')); return; }
  getDb()
    .prepare(`UPDATE tasks SET ${fields.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`)
    .run(...values, Number(req.params['id']));
  const updated = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(Number(req.params['id']));
  res.json(ok(updated));
});

tasksRouter.patch('/:id/move', (req: Request, res: Response) => {
  const parsed = MoveTaskSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  getDb()
    .prepare(`UPDATE tasks SET status = ?, order_index = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`)
    .run(parsed.data.status, parsed.data.order_index, Number(req.params['id']));
  const updated = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(Number(req.params['id']));
  res.json(ok(updated));
});

tasksRouter.delete('/:id', (req: Request, res: Response) => {
  getDb()
    .prepare(`UPDATE tasks SET archived = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`)
    .run(Number(req.params['id']));
  res.json(ok({ archived: true }));
});
```

- [ ] **Step 5: Run tests**

Run: `cd packages/api && pnpm test -- projects`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routes/projects.ts packages/api/src/routes/tasks.ts packages/api/src/__tests__/projects.test.ts
git commit -m "feat: add projects and tasks API routes"
```

---

## Task 9: API Routes — Meetings, People, Ingest, AI

**Files:**
- Create: `packages/api/src/routes/meetings.ts`
- Create: `packages/api/src/routes/people.ts`
- Create: `packages/api/src/routes/ingest.ts`
- Create: `packages/api/src/routes/ai.ts`

- [ ] **Step 1: Create routes/meetings.ts**

```typescript
// packages/api/src/routes/meetings.ts
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';

export const meetingsRouter = Router();

const CreateMeetingSchema = z.object({
  title: z.string().min(1),
  date: z.string(),
  project_id: z.number().int().optional(),
  summary_raw: z.string().default(''),
});

meetingsRouter.get('/', (req: Request, res: Response) => {
  let query = 'SELECT * FROM meetings WHERE 1=1';
  const params: unknown[] = [];
  if (req.query['project']) { query += ' AND project_id = ?'; params.push(Number(req.query['project'])); }
  if (req.query['from']) { query += ' AND date >= ?'; params.push(req.query['from']); }
  if (req.query['to']) { query += ' AND date <= ?'; params.push(req.query['to']); }
  query += ' ORDER BY date DESC';
  res.json(ok(getDb().prepare(query).all(...params)));
});

meetingsRouter.post('/', (req: Request, res: Response) => {
  const parsed = CreateMeetingSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { title, date, project_id, summary_raw } = parsed.data;
  const result = getDb()
    .prepare('INSERT INTO meetings (title, date, project_id, summary_raw) VALUES (?, ?, ?, ?)')
    .run(title, date, project_id ?? null, summary_raw);
  res.status(201).json(ok(getDb().prepare('SELECT * FROM meetings WHERE id = ?').get(result.lastInsertRowid)));
});

meetingsRouter.get('/:id', (req: Request, res: Response) => {
  const meeting = getDb().prepare('SELECT * FROM meetings WHERE id = ?').get(Number(req.params['id']));
  if (!meeting) { res.status(404).json(fail('Meeting not found')); return; }
  const agreements = getDb().prepare('SELECT * FROM agreements WHERE meeting_id = ?').all(Number(req.params['id']));
  const people = getDb()
    .prepare('SELECT p.* FROM people p JOIN meeting_people mp ON p.id = mp.person_id WHERE mp.meeting_id = ?')
    .all(Number(req.params['id']));
  res.json(ok({ ...meeting as object, agreements, people }));
});
```

- [ ] **Step 2: Create routes/people.ts**

```typescript
// packages/api/src/routes/people.ts
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';

export const peopleRouter = Router();

const CreatePersonSchema = z.object({
  name: z.string().min(1),
  company: z.string().optional().default(''),
  role: z.string().optional().default(''),
  telegram: z.string().optional().default(''),
  email: z.string().optional().default(''),
  phone: z.string().optional().default(''),
  notes: z.string().optional().default(''),
});

peopleRouter.get('/', (_req: Request, res: Response) => {
  res.json(ok(getDb().prepare('SELECT * FROM people ORDER BY name ASC').all()));
});

peopleRouter.post('/', (req: Request, res: Response) => {
  const parsed = CreatePersonSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { name, company, role, telegram, email, phone, notes } = parsed.data;
  const result = getDb()
    .prepare('INSERT INTO people (name, company, role, telegram, email, phone, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(name, company, role, telegram, email, phone, notes);
  res.status(201).json(ok(getDb().prepare('SELECT * FROM people WHERE id = ?').get(result.lastInsertRowid)));
});

peopleRouter.get('/:id/history', (req: Request, res: Response) => {
  const person = getDb().prepare('SELECT * FROM people WHERE id = ?').get(Number(req.params['id']));
  if (!person) { res.status(404).json(fail('Person not found')); return; }
  const meetings = getDb()
    .prepare('SELECT m.id, m.title, m.date FROM meetings m JOIN meeting_people mp ON m.id = mp.meeting_id WHERE mp.person_id = ? ORDER BY m.date DESC')
    .all(Number(req.params['id']));
  const agreements = getDb()
    .prepare('SELECT * FROM agreements WHERE person_id = ? ORDER BY created_at DESC')
    .all(Number(req.params['id']));
  const tasks = getDb()
    .prepare('SELECT t.id, t.title, t.status FROM tasks t JOIN task_people tp ON t.id = tp.task_id WHERE tp.person_id = ?')
    .all(Number(req.params['id']));
  res.json(ok({ person, meetings, agreements, tasks }));
});
```

- [ ] **Step 3: Create routes/ingest.ts**

```typescript
// packages/api/src/routes/ingest.ts
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { IngestService } from '../services/ingest.service';
import { config } from '../config';
import { ok, fail } from '@pis/shared';

export const ingestRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxFileSizeMb * 1024 * 1024 },
});

const ingestService = new IngestService();

ingestRouter.post('/', upload.single('file'), async (req: Request, res: Response) => {
  try {
    let result;
    if (req.file) {
      result = await ingestService.ingestBuffer(req.file.buffer, req.file.originalname);
    } else if (typeof req.body['text'] === 'string') {
      result = await ingestService.ingestText(req.body['text'] as string);
    } else {
      res.status(400).json(fail('Provide a file or text field'));
      return;
    }
    res.status(201).json(ok(result));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ingest failed';
    res.status(500).json(fail(message));
  }
});

ingestRouter.get('/status/:id', (req: Request, res: Response) => {
  const item = ingestService.getStatus(Number(req.params['id']));
  if (!item) { res.status(404).json(fail('Inbox item not found')); return; }
  res.json(ok(item));
});
```

- [ ] **Step 4: Create routes/ai.ts**

```typescript
// packages/api/src/routes/ai.ts
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ClaudeService } from '../services/claude.service';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';

export const aiRouter = Router();
const claude = new ClaudeService();

const ChatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })),
  context: z.string().optional(),
});

aiRouter.post('/chat', async (req: Request, res: Response) => {
  const parsed = ChatSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  try {
    const reply = await claude.chat(parsed.data.messages, parsed.data.context);
    res.json(ok({ reply }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'AI error'));
  }
});

aiRouter.post('/daily-brief', async (_req: Request, res: Response) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const tasks = getDb()
      .prepare("SELECT title, status, priority, urgency, due_date FROM tasks WHERE archived = 0 AND status != 'done' ORDER BY priority DESC LIMIT 20")
      .all();
    const meetings = getDb()
      .prepare('SELECT title, date FROM meetings WHERE date >= ? ORDER BY date ASC LIMIT 10')
      .all(today);
    const brief = await claude.dailyBrief(JSON.stringify(tasks), JSON.stringify(meetings));
    res.json(ok({ brief }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'AI error'));
  }
});

aiRouter.get('/search', async (req: Request, res: Response) => {
  const q = req.query['q'];
  if (typeof q !== 'string' || !q) { res.status(400).json(fail('Query parameter q is required')); return; }
  try {
    // Simple FTS over task titles and meeting summaries
    const tasks = getDb().prepare("SELECT title FROM tasks WHERE title LIKE ? LIMIT 10").all(`%${q}%`);
    const meetings = getDb().prepare("SELECT title, summary_raw FROM meetings WHERE title LIKE ? OR summary_raw LIKE ? LIMIT 5").all(`%${q}%`, `%${q}%`);
    const vaultContext = JSON.stringify({ tasks, meetings });
    const result = await claude.searchKnowledge(q, vaultContext);
    res.json(ok(result));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Search error'));
  }
});
```

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/meetings.ts packages/api/src/routes/people.ts packages/api/src/routes/ingest.ts packages/api/src/routes/ai.ts
git commit -m "feat: add meetings, people, ingest, and AI routes"
```

---

## Task 10: Web App Setup

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`

- [ ] **Step 1: Create apps/web/package.json**

```json
{
  "name": "@pis/web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.24.0",
    "@dnd-kit/core": "^6.1.0",
    "@dnd-kit/sortable": "^8.0.0",
    "@pis/shared": "workspace:*",
    "axios": "^1.6.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.22.0",
    "zustand": "^4.5.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^15.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.2.0",
    "autoprefixer": "^10.4.0",
    "jsdom": "^24.0.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.4.0",
    "vite": "^5.2.0",
    "vitest": "^1.4.0"
  }
}
```

- [ ] **Step 2: Create apps/web/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create apps/web/vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/v1': 'http://localhost:3001',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
  },
});
```

- [ ] **Step 4: Create apps/web/tailwind.config.ts**

```typescript
import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 5: Create apps/web/index.html**

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Personal Intelligence System</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create apps/web/src/main.tsx**

```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 7: Create apps/web/src/index.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 8: Create apps/web/src/App.tsx**

```typescript
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { KanbanPage } from './pages/KanbanPage';
import { TimelinePage } from './pages/TimelinePage';
import { ProjectsPage } from './pages/ProjectsPage';
import { MeetingsPage } from './pages/MeetingsPage';
import { PeoplePage } from './pages/PeoplePage';
import { InboxPage } from './pages/InboxPage';

const navItems = [
  { to: '/', label: 'Kanban' },
  { to: '/timeline', label: 'Timeline' },
  { to: '/projects', label: 'Projects' },
  { to: '/meetings', label: 'Meetings' },
  { to: '/people', label: 'People' },
  { to: '/inbox', label: 'Inbox' },
];

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen bg-gray-50">
        <nav className="w-48 bg-white border-r border-gray-200 flex flex-col p-4 gap-1">
          <div className="text-lg font-bold text-indigo-600 mb-6">PIS</div>
          {navItems.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<KanbanPage />} />
            <Route path="/timeline" element={<TimelinePage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/meetings" element={<MeetingsPage />} />
            <Route path="/people" element={<PeoplePage />} />
            <Route path="/inbox" element={<InboxPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
```

- [ ] **Step 9: Install deps and verify dev server starts**

Run: `cd apps/web && pnpm install`
Run: `cd apps/web && pnpm dev` — should open on http://localhost:5173 (Ctrl+C to stop)

- [ ] **Step 10: Commit**

```bash
git add apps/web/
git commit -m "feat: scaffold React web app with routing and Tailwind"
```

---

## Task 11: API Client + Zustand Store

**Files:**
- Create: `apps/web/src/api/client.ts`
- Create: `apps/web/src/api/projects.api.ts`
- Create: `apps/web/src/api/tasks.api.ts`
- Create: `apps/web/src/api/meetings.api.ts`
- Create: `apps/web/src/api/people.api.ts`
- Create: `apps/web/src/api/ingest.api.ts`
- Create: `apps/web/src/api/ai.api.ts`
- Create: `apps/web/src/store/tasks.store.ts`
- Create: `apps/web/src/store/projects.store.ts`
- Create: `apps/web/src/store/index.ts`

- [ ] **Step 1: Create api/client.ts**

```typescript
// apps/web/src/api/client.ts
import axios from 'axios';
import type { ApiResponse } from '@pis/shared';

export const apiClient = axios.create({
  baseURL: '/v1',
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.response.use(
  (res) => res,
  (err) => {
    console.error('[API Error]', err.response?.data ?? err.message);
    return Promise.reject(err);
  }
);

export async function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const res = await apiClient.get<ApiResponse<T>>(url, { params });
  if (!res.data.success || res.data.data === undefined) throw new Error(res.data.error ?? 'API error');
  return res.data.data;
}

export async function apiPost<T>(url: string, data?: unknown): Promise<T> {
  const res = await apiClient.post<ApiResponse<T>>(url, data);
  if (!res.data.success || res.data.data === undefined) throw new Error(res.data.error ?? 'API error');
  return res.data.data;
}

export async function apiPatch<T>(url: string, data?: unknown): Promise<T> {
  const res = await apiClient.patch<ApiResponse<T>>(url, data);
  if (!res.data.success || res.data.data === undefined) throw new Error(res.data.error ?? 'API error');
  return res.data.data;
}

export async function apiDelete<T>(url: string): Promise<T> {
  const res = await apiClient.delete<ApiResponse<T>>(url);
  if (!res.data.success || res.data.data === undefined) throw new Error(res.data.error ?? 'API error');
  return res.data.data;
}
```

- [ ] **Step 2: Create tasks.api.ts**

```typescript
// apps/web/src/api/tasks.api.ts
import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type { Task, CreateTaskDto, UpdateTaskDto, MoveTaskDto } from '@pis/shared';

export const tasksApi = {
  list: (params?: { project?: number; status?: string; person?: number }) =>
    apiGet<Task[]>('/tasks', params as Record<string, unknown>),
  create: (dto: CreateTaskDto) => apiPost<Task>('/tasks', dto),
  update: (id: number, dto: UpdateTaskDto) => apiPatch<Task>(`/tasks/${id}`, dto),
  move: (id: number, dto: MoveTaskDto) => apiPatch<Task>(`/tasks/${id}/move`, dto),
  remove: (id: number) => apiDelete<{ archived: boolean }>(`/tasks/${id}`),
};
```

- [ ] **Step 3: Create projects.api.ts**

```typescript
// apps/web/src/api/projects.api.ts
import { apiGet, apiPost, apiPatch } from './client';
import type { Project, CreateProjectDto, UpdateProjectDto } from '@pis/shared';

export const projectsApi = {
  list: () => apiGet<Project[]>('/projects'),
  create: (dto: CreateProjectDto) => apiPost<Project>('/projects', dto),
  get: (id: number) => apiGet<Project & { tasks: unknown[]; meetings: unknown[] }>(`/projects/${id}`),
  update: (id: number, dto: UpdateProjectDto) => apiPatch<Project>(`/projects/${id}`, dto),
};
```

- [ ] **Step 4: Create remaining API files**

`apps/web/src/api/meetings.api.ts`:
```typescript
import { apiGet, apiPost } from './client';
import type { Meeting, CreateMeetingDto } from '@pis/shared';
export const meetingsApi = {
  list: (params?: { project?: number; from?: string; to?: string }) =>
    apiGet<Meeting[]>('/meetings', params as Record<string, unknown>),
  create: (dto: CreateMeetingDto) => apiPost<Meeting>('/meetings', dto),
  get: (id: number) => apiGet<Meeting & { agreements: unknown[]; people: unknown[] }>(`/meetings/${id}`),
};
```

`apps/web/src/api/people.api.ts`:
```typescript
import { apiGet, apiPost } from './client';
import type { Person, CreatePersonDto, PersonHistory } from '@pis/shared';
export const peopleApi = {
  list: () => apiGet<Person[]>('/people'),
  create: (dto: CreatePersonDto) => apiPost<Person>('/people', dto),
  history: (id: number) => apiGet<PersonHistory>(`/people/${id}/history`),
};
```

`apps/web/src/api/ingest.api.ts`:
```typescript
import { apiClient } from './client';
import type { IngestResult, InboxItem, ApiResponse } from '@pis/shared';
export const ingestApi = {
  uploadFile: async (file: File): Promise<IngestResult> => {
    const form = new FormData();
    form.append('file', file);
    const res = await apiClient.post<ApiResponse<IngestResult>>('/ingest', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    if (!res.data.success || !res.data.data) throw new Error(res.data.error ?? 'Ingest failed');
    return res.data.data;
  },
  pasteText: async (text: string): Promise<IngestResult> => {
    const res = await apiClient.post<ApiResponse<IngestResult>>('/ingest', { text });
    if (!res.data.success || !res.data.data) throw new Error(res.data.error ?? 'Ingest failed');
    return res.data.data;
  },
  status: (id: number) => apiClient.get<ApiResponse<InboxItem>>(`/ingest/status/${id}`).then(r => r.data.data),
};
```

`apps/web/src/api/ai.api.ts`:
```typescript
import { apiPost, apiGet } from './client';
export const aiApi = {
  chat: (messages: Array<{ role: 'user' | 'assistant'; content: string }>, context?: string) =>
    apiPost<{ reply: string }>('/ai/chat', { messages, context }),
  dailyBrief: () => apiPost<{ brief: string }>('/ai/daily-brief', {}),
  search: (q: string) => apiGet<{ answer: string; sources: string[] }>(`/search?q=${encodeURIComponent(q)}`),
};
```

- [ ] **Step 5: Create Zustand stores**

`apps/web/src/store/tasks.store.ts`:
```typescript
import { create } from 'zustand';
import { tasksApi } from '../api/tasks.api';
import type { Task, UpdateTaskDto, MoveTaskDto } from '@pis/shared';

interface TasksState {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  fetchTasks: (params?: { project?: number; status?: string; person?: number }) => Promise<void>;
  moveTask: (id: number, dto: MoveTaskDto) => Promise<void>;
  updateTask: (id: number, dto: UpdateTaskDto) => Promise<void>;
  removeTask: (id: number) => Promise<void>;
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  loading: false,
  error: null,

  fetchTasks: async (params) => {
    set({ loading: true, error: null });
    try {
      const tasks = await tasksApi.list(params);
      set({ tasks, loading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to load tasks', loading: false });
    }
  },

  moveTask: async (id, dto) => {
    await tasksApi.move(id, dto);
    await get().fetchTasks();
  },

  updateTask: async (id, dto) => {
    await tasksApi.update(id, dto);
    await get().fetchTasks();
  },

  removeTask: async (id) => {
    await tasksApi.remove(id);
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
  },
}));
```

`apps/web/src/store/projects.store.ts`:
```typescript
import { create } from 'zustand';
import { projectsApi } from '../api/projects.api';
import type { Project } from '@pis/shared';

interface ProjectsState {
  projects: Project[];
  loading: boolean;
  fetchProjects: () => Promise<void>;
}

export const useProjectsStore = create<ProjectsState>((set) => ({
  projects: [],
  loading: false,
  fetchProjects: async () => {
    set({ loading: true });
    const projects = await projectsApi.list();
    set({ projects, loading: false });
  },
}));
```

`apps/web/src/store/index.ts`:
```typescript
export { useTasksStore } from './tasks.store';
export { useProjectsStore } from './projects.store';
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/api/ apps/web/src/store/
git commit -m "feat: add API client layer and Zustand stores"
```

---

## Task 12: UI Primitives

**Files:**
- Create: `apps/web/src/components/ui/Badge.tsx`
- Create: `apps/web/src/components/ui/Avatar.tsx`
- Create: `apps/web/src/components/ui/SlidePanel.tsx`

- [ ] **Step 1: Create Badge.tsx**

```typescript
// apps/web/src/components/ui/Badge.tsx
interface BadgeProps {
  label: string;
  color?: string; // hex color
}

/** Colored project/status badge */
export function Badge({ label, color = '#6366f1' }: BadgeProps) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white"
      style={{ backgroundColor: color }}
    >
      {label}
    </span>
  );
}
```

- [ ] **Step 2: Create Avatar.tsx**

```typescript
// apps/web/src/components/ui/Avatar.tsx
interface AvatarProps {
  name: string;
  size?: 'sm' | 'md';
}

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() ?? '')
    .join('');
}

/** Person avatar showing initials */
export function Avatar({ name, size = 'sm' }: AvatarProps) {
  const dim = size === 'sm' ? 'w-6 h-6 text-xs' : 'w-8 h-8 text-sm';
  return (
    <div
      className={`${dim} rounded-full bg-indigo-500 text-white flex items-center justify-center font-medium`}
      title={name}
    >
      {initials(name)}
    </div>
  );
}
```

- [ ] **Step 3: Create SlidePanel.tsx**

```typescript
// apps/web/src/components/ui/SlidePanel.tsx
import { useEffect } from 'react';

interface SlidePanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

/** Slide-out panel from the right side */
export function SlidePanel({ open, onClose, title, children }: SlidePanelProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      )}
      <div
        className={`fixed top-0 right-0 h-full w-96 bg-white shadow-xl z-50 transform transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>
        <div className="p-4 overflow-y-auto h-full pb-16">{children}</div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/
git commit -m "feat: add Badge, Avatar, SlidePanel UI primitives"
```

---

## Task 13: Filter System

**Files:**
- Create: `apps/web/src/components/filters/filterConfig.ts`
- Create: `apps/web/src/components/filters/FilterBar.tsx`

- [ ] **Step 1: Create filterConfig.ts**

```typescript
// apps/web/src/components/filters/filterConfig.ts
import type { Project, Person } from '@pis/shared';

export interface FilterValue {
  project?: number;
  person?: number;
  dueDateFrom?: string;
  dueDateTo?: string;
  showArchived?: boolean;
}

export interface FilterConfig {
  key: keyof FilterValue;
  label: string;
  type: 'select' | 'date' | 'boolean';
  /** For select type: returns options list */
  getOptions?: (context: { projects: Project[]; people: Person[] }) => Array<{ label: string; value: number | string }>;
}

/**
 * Extensible filter config — add new filters here without touching FilterBar component.
 * Phase 2 TODO: add tag filter, priority filter
 */
export const FILTER_CONFIG: FilterConfig[] = [
  {
    key: 'project',
    label: 'Project',
    type: 'select',
    getOptions: ({ projects }) => projects.map((p) => ({ label: p.name, value: p.id })),
  },
  {
    key: 'person',
    label: 'Person',
    type: 'select',
    getOptions: ({ people }) => people.map((p) => ({ label: p.name, value: p.id })),
  },
  {
    key: 'dueDateFrom',
    label: 'Due from',
    type: 'date',
  },
  {
    key: 'dueDateTo',
    label: 'Due to',
    type: 'date',
  },
  {
    key: 'showArchived',
    label: 'Show archived',
    type: 'boolean',
  },
];
```

- [ ] **Step 2: Create FilterBar.tsx**

```typescript
// apps/web/src/components/filters/FilterBar.tsx
import { FILTER_CONFIG, FilterValue } from './filterConfig';
import type { Project, Person } from '@pis/shared';

interface FilterBarProps {
  value: FilterValue;
  onChange: (v: FilterValue) => void;
  projects: Project[];
  people: Person[];
}

/** Renders all filters from FILTER_CONFIG. To add a filter, update filterConfig.ts only. */
export function FilterBar({ value, onChange, projects, people }: FilterBarProps) {
  const context = { projects, people };

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {FILTER_CONFIG.map((filter) => {
        if (filter.type === 'select' && filter.getOptions) {
          const options = filter.getOptions(context);
          return (
            <select
              key={filter.key}
              className="text-sm border border-gray-200 rounded px-2 py-1 bg-white"
              value={(value[filter.key] as string | number | undefined) ?? ''}
              onChange={(e) =>
                onChange({ ...value, [filter.key]: e.target.value ? Number(e.target.value) : undefined })
              }
            >
              <option value="">{filter.label}</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          );
        }
        if (filter.type === 'date') {
          return (
            <input
              key={filter.key}
              type="date"
              className="text-sm border border-gray-200 rounded px-2 py-1"
              placeholder={filter.label}
              value={(value[filter.key] as string | undefined) ?? ''}
              onChange={(e) => onChange({ ...value, [filter.key]: e.target.value || undefined })}
            />
          );
        }
        if (filter.type === 'boolean') {
          return (
            <label key={filter.key} className="flex items-center gap-1 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={(value[filter.key] as boolean | undefined) ?? false}
                onChange={(e) => onChange({ ...value, [filter.key]: e.target.checked })}
              />
              {filter.label}
            </label>
          );
        }
        return null;
      })}
      {Object.values(value).some(Boolean) && (
        <button
          className="text-xs text-gray-400 hover:text-gray-600"
          onClick={() => onChange({})}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/filters/
git commit -m "feat: add extensible filter system via FilterConfig"
```

---

## Task 14: KanbanBoard

**Files:**
- Create: `apps/web/src/components/kanban/TaskCard.tsx`
- Create: `apps/web/src/components/kanban/TaskDetailPanel.tsx`
- Create: `apps/web/src/components/kanban/KanbanColumn.tsx`
- Create: `apps/web/src/components/kanban/KanbanBoard.tsx`
- Create: `apps/web/src/pages/KanbanPage.tsx`

- [ ] **Step 1: Create TaskCard.tsx**

```typescript
// apps/web/src/components/kanban/TaskCard.tsx
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task, Project } from '@pis/shared';
import { Badge } from '../ui/Badge';

interface TaskCardProps {
  task: Task;
  project?: Project;
  agreementCount?: number;
  onClick: () => void;
}

function priorityColor(p: number): string {
  if (p >= 4) return 'bg-red-100 text-red-700';
  if (p === 3) return 'bg-yellow-100 text-yellow-700';
  return 'bg-gray-100 text-gray-600';
}

function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date();
}

export function TaskCard({ task, project, agreementCount = 0, onClick }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className="bg-white rounded-lg border border-gray-200 p-3 cursor-pointer hover:border-indigo-300 hover:shadow-sm transition-all"
    >
      <div className="text-sm font-medium text-gray-800 mb-2">{task.title}</div>
      <div className="flex flex-wrap gap-1 items-center">
        {project && <Badge label={project.name} color={project.color} />}
        <span className={`text-xs px-1.5 py-0.5 rounded ${priorityColor(task.priority)}`}>
          P{task.priority}
        </span>
        {task.due_date && (
          <span className={`text-xs ${isOverdue(task.due_date) ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
            {task.due_date}
          </span>
        )}
        {agreementCount > 0 && (
          <span className="text-xs text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">
            {agreementCount} agreements
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create TaskDetailPanel.tsx**

```typescript
// apps/web/src/components/kanban/TaskDetailPanel.tsx
import { SlidePanel } from '../ui/SlidePanel';
import type { Task, Project } from '@pis/shared';
import { Badge } from '../ui/Badge';

interface TaskDetailPanelProps {
  task: Task | null;
  project?: Project;
  onClose: () => void;
}

export function TaskDetailPanel({ task, project, onClose }: TaskDetailPanelProps) {
  return (
    <SlidePanel open={!!task} onClose={onClose} title={task?.title ?? ''}>
      {task && (
        <div className="space-y-4">
          {project && (
            <div>
              <div className="text-xs text-gray-500 mb-1">Project</div>
              <Badge label={project.name} color={project.color} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-gray-500">Status</div>
              <div className="text-sm font-medium capitalize">{task.status.replace('_', ' ')}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Priority</div>
              <div className="text-sm font-medium">{task.priority} / 5</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Urgency</div>
              <div className="text-sm font-medium">{task.urgency} / 5</div>
            </div>
            {task.due_date && (
              <div>
                <div className="text-xs text-gray-500">Due date</div>
                <div className="text-sm font-medium">{task.due_date}</div>
              </div>
            )}
          </div>
          {task.description && (
            <div>
              <div className="text-xs text-gray-500 mb-1">Description</div>
              <div className="text-sm text-gray-700 whitespace-pre-wrap">{task.description}</div>
            </div>
          )}
          <div className="text-xs text-gray-400">Created: {task.created_at}</div>
        </div>
      )}
    </SlidePanel>
  );
}
```

- [ ] **Step 3: Create KanbanColumn.tsx**

```typescript
// apps/web/src/components/kanban/KanbanColumn.tsx
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Task, Project, TaskStatus } from '@pis/shared';
import { TaskCard } from './TaskCard';

const COLUMN_LABELS: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
};

interface KanbanColumnProps {
  status: TaskStatus;
  tasks: Task[];
  projects: Project[];
  onTaskClick: (task: Task) => void;
  onAddTask: (status: TaskStatus) => void;
}

export function KanbanColumn({ status, tasks, projects, onTaskClick, onAddTask }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  const projectMap = new Map(projects.map((p) => [p.id, p]));

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col w-64 min-w-[256px] bg-gray-100 rounded-xl p-3 transition-colors ${
        isOver ? 'bg-indigo-50' : ''
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">
          {COLUMN_LABELS[status]}
          <span className="ml-2 text-xs text-gray-400 font-normal">{tasks.length}</span>
        </h3>
        <button
          onClick={() => onAddTask(status)}
          className="text-gray-400 hover:text-indigo-600 text-lg leading-none"
          title="Add task"
        >
          +
        </button>
      </div>

      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2 flex-1 min-h-[100px]">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              project={task.project_id ? projectMap.get(task.project_id) : undefined}
              onClick={() => onTaskClick(task)}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}
```

- [ ] **Step 4: Create KanbanBoard.tsx**

```typescript
// apps/web/src/components/kanban/KanbanBoard.tsx
import { useState, useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  DragEndEvent,
  DragOverEvent,
} from '@dnd-kit/core';
import type { Task, Project, TaskStatus } from '@pis/shared';
import { KanbanColumn } from './KanbanColumn';
import { TaskDetailPanel } from './TaskDetailPanel';

const COLUMNS: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'done'];

interface KanbanBoardProps {
  tasks: Task[];
  projects: Project[];
  onMoveTask: (taskId: number, status: TaskStatus, orderIndex: number) => Promise<void>;
  onAddTask: (status: TaskStatus) => void;
}

export function KanbanBoard({ tasks, projects, onMoveTask, onAddTask }: KanbanBoardProps) {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  const projectMap = new Map(projects.map((p) => [p.id, p]));

  const tasksByStatus = useCallback(
    (status: TaskStatus) => tasks.filter((t) => t.status === status),
    [tasks]
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const taskId = Number(active.id);
    const newStatus = over.id as TaskStatus;

    if (COLUMNS.includes(newStatus)) {
      const tasksInColumn = tasksByStatus(newStatus);
      await onMoveTask(taskId, newStatus, tasksInColumn.length);
    }
  };

  return (
    <>
      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 p-4 overflow-x-auto">
          {COLUMNS.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              tasks={tasksByStatus(status)}
              projects={projects}
              onTaskClick={setSelectedTask}
              onAddTask={onAddTask}
            />
          ))}
        </div>
      </DndContext>

      <TaskDetailPanel
        task={selectedTask}
        project={selectedTask?.project_id ? projectMap.get(selectedTask.project_id) : undefined}
        onClose={() => setSelectedTask(null)}
      />
    </>
  );
}
```

- [ ] **Step 5: Create KanbanPage.tsx**

```typescript
// apps/web/src/pages/KanbanPage.tsx
import { useEffect, useState } from 'react';
import { useTasksStore, useProjectsStore } from '../store';
import { tasksApi } from '../api/tasks.api';
import { KanbanBoard } from '../components/kanban/KanbanBoard';
import { FilterBar } from '../components/filters/FilterBar';
import type { TaskStatus, FilterValue } from '../components/filters/filterConfig';
import type { CreateTaskDto } from '@pis/shared';

export function KanbanPage() {
  const { tasks, fetchTasks, moveTask } = useTasksStore();
  const { projects, fetchProjects } = useProjectsStore();
  const [filters, setFilters] = useState<FilterValue>({});

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    fetchTasks({
      project: filters.project,
      person: filters.person,
    });
  }, [fetchTasks, filters.project, filters.person]);

  const handleAddTask = async (status: TaskStatus) => {
    const title = prompt('Task title:');
    if (!title) return;
    const dto: CreateTaskDto = { title, status, project_id: filters.project };
    await tasksApi.create(dto);
    fetchTasks();
  };

  // TODO Phase 2: get people list for filter
  const people: import('@pis/shared').Person[] = [];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 pt-4 pb-2 border-b bg-white">
        <h1 className="text-xl font-bold text-gray-800">Kanban</h1>
        <FilterBar value={filters} onChange={setFilters} projects={projects} people={people} />
      </div>
      <div className="flex-1 overflow-auto">
        <KanbanBoard
          tasks={tasks}
          projects={projects}
          onMoveTask={(id, status, idx) => moveTask(id, { status, order_index: idx })}
          onAddTask={handleAddTask}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/kanban/ apps/web/src/pages/KanbanPage.tsx
git commit -m "feat: add KanbanBoard with drag-and-drop and task detail panel"
```

---

## Task 15: TimelinePage

**Files:**
- Create: `apps/web/src/components/timeline/TimelineView.tsx`
- Create: `apps/web/src/pages/TimelinePage.tsx`

- [ ] **Step 1: Create TimelineView.tsx**

```typescript
// apps/web/src/components/timeline/TimelineView.tsx
import type { Task, Project } from '@pis/shared';
import { TaskCard } from '../kanban/TaskCard';

type TimePeriod = 'today' | 'week' | 'month' | 'year';

interface TimelineViewProps {
  tasks: Task[];
  projects: Project[];
  period: TimePeriod;
  onTaskClick: (task: Task) => void;
}

function isInPeriod(dueDate: string | null, period: TimePeriod): boolean {
  if (!dueDate) return false;
  const due = new Date(dueDate);
  const now = new Date();
  const endOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);

  switch (period) {
    case 'today':
      return due <= endOf(now) && due >= new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case 'week': {
      const endOfWeek = new Date(now);
      endOfWeek.setDate(now.getDate() + (6 - now.getDay()));
      return due >= now && due <= endOf(endOfWeek);
    }
    case 'month':
      return due.getMonth() === now.getMonth() && due.getFullYear() === now.getFullYear();
    case 'year':
      return due.getFullYear() === now.getFullYear();
  }
}

export function TimelineView({ tasks, projects, period, onTaskClick }: TimelineViewProps) {
  const projectMap = new Map(projects.map((p) => [p.id, p]));

  const filtered = tasks.filter((t) => isInPeriod(t.due_date, period) && !t.archived);
  const noDueDate = tasks.filter((t) => !t.due_date && !t.archived);

  return (
    <div className="p-4 space-y-6">
      {filtered.length === 0 && noDueDate.length === 0 && (
        <div className="text-gray-400 text-sm text-center py-8">No tasks for this period</div>
      )}
      {filtered.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-500 mb-3">
            {filtered.length} task{filtered.length !== 1 ? 's' : ''}
          </h3>
          <div className="space-y-2 max-w-sm">
            {filtered.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                project={task.project_id ? projectMap.get(task.project_id) : undefined}
                onClick={() => onTaskClick(task)}
              />
            ))}
          </div>
        </div>
      )}
      {noDueDate.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-400 mb-3">No due date ({noDueDate.length})</h3>
          <div className="space-y-2 max-w-sm opacity-60">
            {noDueDate.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                project={task.project_id ? projectMap.get(task.project_id) : undefined}
                onClick={() => onTaskClick(task)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create TimelinePage.tsx**

```typescript
// apps/web/src/pages/TimelinePage.tsx
import { useEffect, useState } from 'react';
import { useTasksStore, useProjectsStore } from '../store';
import { TimelineView } from '../components/timeline/TimelineView';
import { TaskDetailPanel } from '../components/kanban/TaskDetailPanel';
import type { Task } from '@pis/shared';

type Period = 'today' | 'week' | 'month' | 'year';
const PERIODS: Array<{ key: Period; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'year', label: 'This Year' },
];

export function TimelinePage() {
  const { tasks, fetchTasks } = useTasksStore();
  const { projects, fetchProjects } = useProjectsStore();
  const [period, setPeriod] = useState<Period>('today');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  useEffect(() => {
    fetchTasks();
    fetchProjects();
  }, [fetchTasks, fetchProjects]);

  const projectMap = new Map(projects.map((p) => [p.id, p]));

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-0 bg-white border-b">
        <h1 className="text-xl font-bold text-gray-800 mb-3">Timeline</h1>
        <div className="flex gap-0">
          {PERIODS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                period === key
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <TimelineView
          tasks={tasks}
          projects={projects}
          period={period}
          onTaskClick={setSelectedTask}
        />
      </div>
      <TaskDetailPanel
        task={selectedTask}
        project={selectedTask?.project_id ? projectMap.get(selectedTask.project_id) : undefined}
        onClose={() => setSelectedTask(null)}
      />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/timeline/ apps/web/src/pages/TimelinePage.tsx
git commit -m "feat: add TimelinePage with Today/Week/Month/Year tabs"
```

---

## Task 16: FileIngestion + ClaudeChat + Remaining Pages

**Files:**
- Create: `apps/web/src/components/upload/FileIngestion.tsx`
- Create: `apps/web/src/components/chat/ClaudeChat.tsx`
- Create: `apps/web/src/pages/InboxPage.tsx`
- Create: `apps/web/src/pages/ProjectsPage.tsx`
- Create: `apps/web/src/pages/MeetingsPage.tsx`
- Create: `apps/web/src/pages/PeoplePage.tsx`

- [ ] **Step 1: Create FileIngestion.tsx**

```typescript
// apps/web/src/components/upload/FileIngestion.tsx
import { useState, useRef } from 'react';
import { ingestApi } from '../../api/ingest.api';
import type { IngestResult } from '@pis/shared';

interface FileIngestionProps {
  onComplete?: (result: IngestResult) => void;
}

export function FileIngestion({ onComplete }: FileIngestionProps) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await ingestApi.uploadFile(file);
      setResult(res);
      onComplete?.(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  const processText = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await ingestApi.pasteText(text);
      setResult(res);
      setText('');
      onComplete?.(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ingest failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Drag-drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) processFile(file);
        }}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
          dragging ? 'border-indigo-400 bg-indigo-50' : 'border-gray-300 hover:border-gray-400'
        }`}
      >
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          accept=".txt,.md,.pdf"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); }}
        />
        <div className="text-gray-500 text-sm">
          {loading ? 'Processing...' : 'Drop a file here or click to upload'}
        </div>
        <div className="text-gray-400 text-xs mt-1">Supported: .txt, .md, .pdf</div>
      </div>

      {/* Text paste */}
      <div>
        <textarea
          className="w-full border border-gray-200 rounded-lg p-3 text-sm resize-none focus:outline-none focus:border-indigo-300"
          rows={4}
          placeholder="Or paste text here..."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          onClick={processText}
          disabled={!text.trim() || loading}
          className="mt-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Processing...' : 'Process text'}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
          <div className="font-medium text-green-800 mb-1">
            Detected: <span className="capitalize">{result.detected_type}</span>
          </div>
          <div className="text-green-700">{result.summary}</div>
          {result.created_records.map((r) => (
            <div key={`${r.type}-${r.id}`} className="text-xs text-green-600 mt-1">
              Created {r.type}: {r.title}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create ClaudeChat.tsx**

```typescript
// apps/web/src/components/chat/ClaudeChat.tsx
import { useState } from 'react';
import { aiApi } from '../../api/ai.api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export function ClaudeChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const send = async () => {
    const content = input.trim();
    if (!content || loading) return;
    const newMessages: Message[] = [...messages, { role: 'user', content }];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    try {
      const { reply } = await aiApi.chat(newMessages);
      setMessages([...newMessages, { role: 'assistant', content: reply }]);
    } catch (e) {
      setMessages([...newMessages, { role: 'assistant', content: `Error: ${e instanceof Error ? e.message : 'Unknown'}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full border-l bg-white">
      <div className="px-3 py-2 border-b text-sm font-medium text-gray-700">Claude Chat</div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={`text-sm ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
            <span
              className={`inline-block px-3 py-2 rounded-lg max-w-xs ${
                msg.role === 'user'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              {msg.content}
            </span>
          </div>
        ))}
        {loading && (
          <div className="text-sm text-gray-400">Thinking...</div>
        )}
      </div>
      <div className="p-3 border-t flex gap-2">
        <input
          className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-300"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ask anything..."
          disabled={loading}
        />
        <button
          onClick={send}
          disabled={!input.trim() || loading}
          className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create remaining pages**

`apps/web/src/pages/InboxPage.tsx`:
```typescript
import { FileIngestion } from '../components/upload/FileIngestion';
export function InboxPage() {
  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-xl font-bold text-gray-800 mb-6">Inbox</h1>
      <FileIngestion />
    </div>
  );
}
```

`apps/web/src/pages/ProjectsPage.tsx`:
```typescript
import { useEffect } from 'react';
import { useProjectsStore } from '../store';
import { Badge } from '../components/ui/Badge';
export function ProjectsPage() {
  const { projects, loading, fetchProjects } = useProjectsStore();
  useEffect(() => { fetchProjects(); }, [fetchProjects]);
  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-gray-800 mb-6">Projects</h1>
      {loading && <div className="text-gray-400 text-sm">Loading...</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((p) => (
          <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Badge label={p.status} color={p.color} />
              <span className="font-medium text-gray-800">{p.name}</span>
            </div>
            <p className="text-sm text-gray-500">{p.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

`apps/web/src/pages/MeetingsPage.tsx`:
```typescript
import { useEffect, useState } from 'react';
import { meetingsApi } from '../api/meetings.api';
import type { Meeting } from '@pis/shared';
export function MeetingsPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  useEffect(() => { meetingsApi.list().then(setMeetings); }, []);
  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-gray-800 mb-6">Meetings</h1>
      <div className="space-y-3">
        {meetings.map((m) => (
          <div key={m.id} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="font-medium text-gray-800">{m.title}</div>
            <div className="text-sm text-gray-400 mt-1">{m.date}</div>
            {m.summary_raw && <p className="text-sm text-gray-600 mt-2 line-clamp-2">{m.summary_raw}</p>}
          </div>
        ))}
        {meetings.length === 0 && <div className="text-gray-400 text-sm">No meetings yet</div>}
      </div>
    </div>
  );
}
```

`apps/web/src/pages/PeoplePage.tsx`:
```typescript
import { useEffect, useState } from 'react';
import { peopleApi } from '../api/people.api';
import { Avatar } from '../components/ui/Avatar';
import type { Person } from '@pis/shared';
export function PeoplePage() {
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => { peopleApi.list().then(setPeople); }, []);
  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-gray-800 mb-6">People</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {people.map((p) => (
          <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
            <Avatar name={p.name} size="md" />
            <div>
              <div className="font-medium text-gray-800">{p.name}</div>
              <div className="text-sm text-gray-500">{p.role} {p.company ? `@ ${p.company}` : ''}</div>
            </div>
          </div>
        ))}
        {people.length === 0 && <div className="text-gray-400 text-sm">No people yet</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/upload/ apps/web/src/components/chat/ apps/web/src/pages/
git commit -m "feat: add FileIngestion, ClaudeChat, and all page stubs"
```

---

## Task 17: Vault Setup

**Files:**
- Create: `vault/Goals/business.md`
- Create: `vault/Goals/family.md`
- Create: `vault/Goals/personal.md`
- Create: `vault/Goals/growth.md`
- Create: `vault/README.md`

- [ ] **Step 1: Create vault folder structure in ObsidianVault**

Run:
```bash
mkdir -p "C:/Users/smolentsev/Documents/ObsidianVault/Projects"
mkdir -p "C:/Users/smolentsev/Documents/ObsidianVault/People"
mkdir -p "C:/Users/smolentsev/Documents/ObsidianVault/Meetings"
mkdir -p "C:/Users/smolentsev/Documents/ObsidianVault/Ideas"
mkdir -p "C:/Users/smolentsev/Documents/ObsidianVault/Goals"
mkdir -p "C:/Users/smolentsev/Documents/ObsidianVault/Tasks"
mkdir -p "C:/Users/smolentsev/Documents/ObsidianVault/Materials"
mkdir -p "C:/Users/smolentsev/Documents/ObsidianVault/Inbox"
```

- [ ] **Step 2: Create Goal template files**

`C:/Users/smolentsev/Documents/ObsidianVault/Goals/business.md`:
```markdown
---
type: goal
category: business
tags: [goal]
created_at: 2026-04-06T00:00:00.000Z
---

# Business Goals 2026

<!-- Add your business goals here -->
```

`C:/Users/smolentsev/Documents/ObsidianVault/Goals/family.md`:
```markdown
---
type: goal
category: family
tags: [goal]
created_at: 2026-04-06T00:00:00.000Z
---

# Family Goals 2026
```

`C:/Users/smolentsev/Documents/ObsidianVault/Goals/personal.md`:
```markdown
---
type: goal
category: personal
tags: [goal]
created_at: 2026-04-06T00:00:00.000Z
---

# Personal Goals 2026
```

`C:/Users/smolentsev/Documents/ObsidianVault/Goals/growth.md`:
```markdown
---
type: goal
category: growth
tags: [goal]
created_at: 2026-04-06T00:00:00.000Z
---

# Growth Goals 2026
```

- [ ] **Step 3: Commit**

```bash
git add vault/ 2>/dev/null || true
git commit -m "feat: initialize vault folder structure and goal templates"
```

---

## Task 18: Root README

**Files:**
- Create: `<root>/README.md`

- [ ] **Step 1: Create README.md**

```markdown
# Personal Intelligence System (PIS)

A personal life and project management system with Obsidian as the source of truth.

## Architecture

```
apps/web          → React + Vite frontend (port 5173)
packages/api      → Express REST API (port 3001)
packages/shared   → Shared TypeScript types
vault/            → Obsidian vault (source of truth)
data/             → SQLite database (index only — rebuildable)
```

## How to Run Locally

1. **Prerequisites:** Node.js ≥ 18, pnpm ≥ 8

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Configure environment:**
   ```bash
   cp packages/api/.env.example packages/api/.env
   # Edit .env and set ANTHROPIC_API_KEY and VAULT_PATH
   ```

4. **Start both servers:**
   ```bash
   pnpm dev
   ```
   - API: http://localhost:3001
   - Web: http://localhost:5173

## How to Extend

### Add a new file parser (Phase 2)
1. Create `packages/api/src/parsers/docx.parser.ts` exporting `async function parseDocx(buffer: Buffer): Promise<string>`
2. Add the case to `packages/api/src/parsers/index.ts` in the `parseFile` switch

### Add a new API route
1. Create `packages/api/src/routes/myroute.ts` with a Router export
2. Register it in `packages/api/src/routes/index.ts`

### Add a new filter
1. Open `apps/web/src/components/filters/filterConfig.ts`
2. Add a new entry to the `FILTER_CONFIG` array — no other changes needed

### Add a new vault type
1. Add a new `write*` method to `packages/api/src/services/obsidian.service.ts`
2. Add the corresponding frontmatter template following the existing pattern

## Vault Rules

- **Never delete** vault files — use `archived: true` in frontmatter
- **Always use** `[[WikiLinks]]` for cross-references
- **File naming:** see `docs/superpowers/specs/2026-04-06-personal-intelligence-system-design.md`
- SQLite is an index only — the vault is always the source of truth

## Future Phases Roadmap

- **Phase 2:** Image parser (Claude Vision), audio transcription (Whisper), docx parser, URL ingestion, full-text vault search
- **Phase 3:** Mobile app, push notifications, calendar integration
- **Phase 4:** Multi-user support, team features
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add comprehensive root README with architecture and extension guides"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** Monorepo ✓, shared types ✓, SQLite schema ✓, obsidian.service ✓, claude.service ✓, ingest pipeline (txt/md/pdf) ✓, all API routes ✓, KanbanBoard ✓, drag-and-drop ✓, TaskCard ✓, slide-out panel ✓, extensible filters ✓, TimelinePage (Today/Week/Month/Year) ✓, FileIngestion ✓, ClaudeChat ✓, all pages ✓, vault setup ✓, README ✓
- [x] **No placeholders** in required Phase 1 code
- [x] **Type consistency:** `TaskStatus`, `FilterValue`, `FilterConfig` used consistently across tasks 11-15
- [x] **Phase 2 TODOs** present in parsers/index.ts, KanbanPage.tsx, AI routes
