# PostgreSQL Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Clarity Space backend from SQLite (better-sqlite3) to PostgreSQL (node-postgres) for multi-user SaaS readiness.

**Architecture:** Create a thin async wrapper (`db.query/queryOne/queryAll`) around `pg.Pool` that replaces the synchronous `getDb().prepare().run/all/get()` pattern. Convert all ~986 DB call sites across 39 files. Replace FTS5 with PostgreSQL `tsvector/tsquery`. Write a one-time data migration script.

**Tech Stack:** PostgreSQL 16, node-postgres (`pg`), `@types/pg`

**Spec:** `docs/superpowers/specs/2026-06-01-postgresql-migration-design.md`

---

## File Structure

### New files
- `packages/api/src/db/pg.ts` — PostgreSQL Pool wrapper (replaces `db.ts`)
- `packages/api/src/db/schema-pg.sql` — full PostgreSQL schema (all tables, final state)
- `scripts/migrate-sqlite-to-pg.ts` — one-time data migration script

### Modified files (core)
- `packages/api/src/config/index.ts` — add `databaseUrl` config
- `packages/api/src/db/db.ts` — rewrite to delegate to `pg.ts`
- `packages/api/src/index.ts` — async init

### Modified files (routes — 15 files)
- `packages/api/src/routes/tasks.ts` (66 calls)
- `packages/api/src/routes/ai.ts` (88 calls)
- `packages/api/src/routes/goals.ts` (55 calls)
- `packages/api/src/routes/meetings.ts` (59 calls)
- `packages/api/src/routes/widget.ts` (38 calls)
- `packages/api/src/routes/habits.ts` (31 calls)
- `packages/api/src/routes/auth.ts` (34 calls)
- `packages/api/src/routes/admin.ts` (30 calls)
- `packages/api/src/routes/documents.ts` (31 calls)
- `packages/api/src/routes/people.ts` (30 calls)
- `packages/api/src/routes/projects.ts` (21 calls)
- `packages/api/src/routes/export.ts` (12 calls)
- `packages/api/src/routes/google-calendar.ts` (12 calls)
- `packages/api/src/routes/ideas.ts` (13 calls)
- `packages/api/src/routes/templates.ts` (11 calls)
- `packages/api/src/routes/tags.ts` (10 calls)
- `packages/api/src/routes/journal.ts` (10 calls)
- `packages/api/src/routes/search.ts` (3 calls)
- `packages/api/src/routes/claude-notes.ts` (7 calls)
- `packages/api/src/routes/email-webhook.ts` (6 calls)
- `packages/api/src/routes/ingest.ts` (9 calls)

### Modified files (services — 10 files)
- `packages/api/src/services/telegram.service.ts` (191 calls)
- `packages/api/src/services/notification.service.ts` (44 calls)
- `packages/api/src/services/search.service.ts` (35 calls)
- `packages/api/src/services/ingest.service.ts` (28 calls)
- `packages/api/src/services/tools.service.ts` (15 calls)
- `packages/api/src/services/bundle.service.ts` (10 calls)
- `packages/api/src/services/obsidian-sync.service.ts` (12 calls)
- `packages/api/src/services/claude.service.ts` (3 calls)
- `packages/api/src/services/draft-session.ts` (5 calls)
- `packages/api/src/services/whisper-local.service.ts` (1 call)

### Modified files (other)
- `packages/api/src/middleware/auth.ts`
- `packages/api/package.json` — add `pg`, `@types/pg`
- `packages/api/src/scripts/backfill-vault.ts`
- `packages/api/src/scripts/backfill-pro-summaries.ts`

---

## Task 1: Install PostgreSQL on Server + Create Database

**Files:** none (server-side only)

- [ ] **Step 1: Install PostgreSQL 16**

```bash
ssh root@clarity-space.ru "apt update && apt install -y postgresql-16 postgresql-client-16"
```

Expected: PostgreSQL installed, service running

- [ ] **Step 2: Create database and user**

```bash
ssh root@clarity-space.ru "sudo -u postgres psql -c \"CREATE USER clarity WITH PASSWORD 'GENERATE_SECURE_PASSWORD';\""
ssh root@clarity-space.ru "sudo -u postgres psql -c \"CREATE DATABASE clarity_space OWNER clarity;\""
ssh root@clarity-space.ru "sudo -u postgres psql -c \"ALTER USER clarity CREATEDB;\""
```

- [ ] **Step 3: Enable Russian full-text search config**

```bash
ssh root@clarity-space.ru "sudo -u postgres psql -d clarity_space -c \"SELECT cfgname FROM pg_ts_config WHERE cfgname = 'russian';\""
```

Expected: `russian` config exists (built-in with PostgreSQL)

- [ ] **Step 4: Add DATABASE_URL to .env on server**

```bash
ssh root@clarity-space.ru "echo 'DATABASE_URL=postgresql://clarity:PASSWORD@localhost:5432/clarity_space' >> /var/www/kanban-app/.env"
```

- [ ] **Step 5: Commit** — no code changes, just server setup

---

## Task 2: Add `pg` Dependency + Config

**Files:**
- Modify: `packages/api/package.json`
- Modify: `packages/api/src/config/index.ts`

- [ ] **Step 1: Add pg dependency**

```bash
cd packages/api && pnpm add pg && pnpm add -D @types/pg
```

- [ ] **Step 2: Add databaseUrl to config**

In `packages/api/src/config/index.ts`, add after `databasePath` line:

```typescript
databaseUrl: process.env['DATABASE_URL'] ?? '',
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/package.json packages/api/src/config/index.ts pnpm-lock.yaml
git commit -m "feat: add pg dependency and DATABASE_URL config"
```

---

## Task 3: Create PostgreSQL Schema

**Files:**
- Create: `packages/api/src/db/schema-pg.sql`

- [ ] **Step 1: Write the full PostgreSQL schema**

This file contains ALL tables in their final state (no migrations needed — clean slate for PG). All SQLite-isms converted:
- `INTEGER PRIMARY KEY AUTOINCREMENT` → `SERIAL PRIMARY KEY`
- `strftime('%Y-%m-%dT%H:%M:%SZ','now')` → `NOW()`
- `INTEGER` booleans (archived, processed, etc.) → `INTEGER` (keep as-is for compat, app uses 0/1)
- FTS5 virtual table → replaced by `search_vector TSVECTOR` column + GIN index + trigger

```sql
-- schema-pg.sql — Clarity Space PostgreSQL schema (full, no migrations)

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL DEFAULT '',
  name          TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
  email_verified INTEGER NOT NULL DEFAULT 0,
  tg_id         TEXT UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','completed','archived')),
  color       TEXT NOT NULL DEFAULT '#6366f1',
  vault_path  TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  user_id     INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tasks (
  id            SERIAL PRIMARY KEY,
  project_id    INTEGER REFERENCES projects(id),
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'backlog' CHECK(status IN ('backlog','todo','in_progress','done','someday')),
  priority      INTEGER NOT NULL DEFAULT 3 CHECK(priority BETWEEN 1 AND 5),
  urgency       INTEGER NOT NULL DEFAULT 3 CHECK(urgency BETWEEN 1 AND 5),
  due_date      TEXT,
  start_date    TEXT,
  vault_path    TEXT,
  parent_id     INTEGER REFERENCES tasks(id),
  recurrence    TEXT,
  goal_id       INTEGER,
  revenue_impact DOUBLE PRECISION,
  order_index   INTEGER NOT NULL DEFAULT 0,
  user_id       INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived      INTEGER NOT NULL DEFAULT 0,
  search_vector TSVECTOR
);

CREATE INDEX IF NOT EXISTS idx_tasks_search ON tasks USING GIN(search_vector);

CREATE TABLE IF NOT EXISTS people (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  company    TEXT NOT NULL DEFAULT '',
  role       TEXT NOT NULL DEFAULT '',
  telegram   TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  vault_path TEXT,
  project_id INTEGER REFERENCES projects(id),
  meet_asap  INTEGER NOT NULL DEFAULT 0,
  user_id    INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meetings (
  id                 SERIAL PRIMARY KEY,
  title              TEXT NOT NULL,
  date               TEXT NOT NULL,
  project_id         INTEGER REFERENCES projects(id),
  summary_raw        TEXT NOT NULL DEFAULT '',
  summary_structured TEXT,
  vault_path         TEXT,
  source_file        TEXT,
  processed          INTEGER NOT NULL DEFAULT 0,
  sync_vault         INTEGER NOT NULL DEFAULT 1,
  updated_at         TIMESTAMPTZ,
  processing_status  TEXT,
  processing_error   TEXT,
  goal_id            INTEGER,
  user_id            INTEGER REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agreements (
  id          SERIAL PRIMARY KEY,
  meeting_id  INTEGER NOT NULL REFERENCES meetings(id),
  task_id     INTEGER REFERENCES tasks(id),
  person_id   INTEGER REFERENCES people(id),
  description TEXT NOT NULL,
  due_date    TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done','cancelled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ideas (
  id                SERIAL PRIMARY KEY,
  title             TEXT NOT NULL,
  body              TEXT NOT NULL DEFAULT '',
  category          TEXT NOT NULL DEFAULT 'personal' CHECK(category IN ('business','product','personal','growth')),
  project_id        INTEGER REFERENCES projects(id),
  source_meeting_id INTEGER REFERENCES meetings(id),
  vault_path        TEXT,
  status            TEXT NOT NULL DEFAULT 'backlog',
  archived          INTEGER NOT NULL DEFAULT 0,
  user_id           INTEGER REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documents (
  id         SERIAL PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  project_id INTEGER REFERENCES projects(id),
  category   TEXT NOT NULL DEFAULT 'note' CHECK(category IN ('note','reference','template','archive')),
  vault_path TEXT,
  status     TEXT NOT NULL DEFAULT 'draft',
  parent_id  INTEGER REFERENCES documents(id),
  user_id    INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inbox_items (
  id                SERIAL PRIMARY KEY,
  original_filename TEXT NOT NULL,
  original_path     TEXT,
  file_type         TEXT NOT NULL,
  extracted_text    TEXT,
  processed         INTEGER NOT NULL DEFAULT 0,
  target_type       TEXT,
  target_id         INTEGER,
  error             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Junction tables
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

CREATE TABLE IF NOT EXISTS people_projects (
  person_id  INTEGER NOT NULL REFERENCES people(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  PRIMARY KEY (person_id, project_id)
);

CREATE TABLE IF NOT EXISTS meeting_projects (
  meeting_id INTEGER NOT NULL REFERENCES meetings(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  PRIMARY KEY (meeting_id, project_id)
);

CREATE TABLE IF NOT EXISTS task_tags (
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  tag_id  INTEGER NOT NULL REFERENCES tags(id),
  PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id       INTEGER NOT NULL REFERENCES tasks(id),
  depends_on_id INTEGER NOT NULL REFERENCES tasks(id),
  PRIMARY KEY (task_id, depends_on_id)
);

-- Standalone tables
CREATE TABLE IF NOT EXISTS claude_notes (
  id         SERIAL PRIMARY KEY,
  content    TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'telegram',
  processed  INTEGER NOT NULL DEFAULT 0,
  vault_path TEXT,
  user_id    INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attachments (
  id            SERIAL PRIMARY KEY,
  document_id   INTEGER REFERENCES documents(id),
  task_id       INTEGER REFERENCES tasks(id),
  meeting_id    INTEGER REFERENCES meetings(id),
  filename      TEXT NOT NULL,
  original_name TEXT NOT NULL,
  size          INTEGER NOT NULL DEFAULT 0,
  mime_type     TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS habits (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT '✅',
  color       TEXT NOT NULL DEFAULT '#6366f1',
  frequency   TEXT NOT NULL DEFAULT 'daily',
  archived    INTEGER NOT NULL DEFAULT 0,
  remind_time TEXT,
  user_id     INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS habit_logs (
  id        SERIAL PRIMARY KEY,
  habit_id  INTEGER NOT NULL REFERENCES habits(id),
  date      TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 1,
  UNIQUE(habit_id, date)
);

CREATE TABLE IF NOT EXISTS goals (
  id            SERIAL PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  type          TEXT NOT NULL DEFAULT 'goal',
  parent_id     INTEGER REFERENCES goals(id),
  project_id    INTEGER REFERENCES projects(id),
  target_value  DOUBLE PRECISION,
  current_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  unit          TEXT NOT NULL DEFAULT '%',
  due_date      TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  user_id       INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_comments (
  id         SERIAL PRIMARY KEY,
  task_id    INTEGER NOT NULL REFERENCES tasks(id),
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS journal (
  id        SERIAL PRIMARY KEY,
  date      TEXT NOT NULL UNIQUE,
  focus     TEXT NOT NULL DEFAULT '',
  gratitude TEXT NOT NULL DEFAULT '',
  notes     TEXT NOT NULL DEFAULT '',
  results   TEXT NOT NULL DEFAULT '',
  mood      INTEGER NOT NULL DEFAULT 3,
  user_id   INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tags (
  id    SERIAL PRIMARY KEY,
  name  TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  user_id INTEGER REFERENCES users(id),
  UNIQUE(name, user_id)
);

CREATE TABLE IF NOT EXISTS task_templates (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority    INTEGER NOT NULL DEFAULT 3,
  project_id  INTEGER REFERENCES projects(id),
  tags        TEXT NOT NULL DEFAULT '[]',
  user_id     INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key     TEXT NOT NULL,
  value   TEXT NOT NULL DEFAULT '',
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (key, user_id)
);

CREATE TABLE IF NOT EXISTS notification_log (
  user_id INTEGER NOT NULL,
  type    TEXT NOT NULL,
  ref_id  TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, type, ref_id)
);

CREATE TABLE IF NOT EXISTS verification_codes (
  id         SERIAL PRIMARY KEY,
  email      TEXT NOT NULL,
  code       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK(type IN ('register','reset','link_tg')),
  expires_at TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  token      TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS usage_logs (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id),
  type       TEXT NOT NULL,
  model      TEXT NOT NULL DEFAULT '',
  tokens_in  INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_usd   DOUBLE PRECISION NOT NULL DEFAULT 0,
  detail     TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Full-text search trigger for tasks
CREATE OR REPLACE FUNCTION tasks_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('russian', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('russian', COALESCE(NEW.description, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_search_trigger
  BEFORE INSERT OR UPDATE OF title, description ON tasks
  FOR EACH ROW EXECUTE FUNCTION tasks_search_update();
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/db/schema-pg.sql
git commit -m "feat: add PostgreSQL schema with full-text search"
```

---

## Task 4: Create PostgreSQL DB Wrapper (`pg.ts`)

**Files:**
- Create: `packages/api/src/db/pg.ts`

This is the key abstraction — a thin wrapper that provides a similar interface to the current `getDb()` pattern, but async and using `pg.Pool`.

- [ ] **Step 1: Write `pg.ts`**

```typescript
import { Pool, PoolConfig, QueryResult, QueryResultRow } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

let _pool: Pool | null = null;

/** Initialize the PostgreSQL connection pool */
export async function initPg(databaseUrl: string): Promise<void> {
  const poolConfig: PoolConfig = {
    connectionString: databaseUrl,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };
  _pool = new Pool(poolConfig);
  // Verify connection
  const client = await _pool.connect();
  client.release();
  console.log('[db] PostgreSQL connected');
}

/** Run schema from file (used on first setup) */
export async function runSchema(): Promise<void> {
  const pool = getPool();
  const sql = fs.readFileSync(path.resolve(__dirname, 'schema-pg.sql'), 'utf-8');
  await pool.query(sql);
  console.log('[db] schema applied');
}

/** Get the connection pool (throws if not initialized) */
export function getPool(): Pool {
  if (!_pool) throw new Error('PostgreSQL pool not initialized. Call initPg() first.');
  return _pool;
}

/** Execute a query, return full result */
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return getPool().query<T>(sql, params);
}

/** Execute a query, return all rows */
export async function queryAll<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await getPool().query<T>(sql, params);
  return result.rows;
}

/** Execute a query, return first row or undefined */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[]
): Promise<T | undefined> {
  const result = await getPool().query<T>(sql, params);
  return result.rows[0];
}

/** Execute a query, return first row (throw if not found) */
export async function queryOneOrFail<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[]
): Promise<T> {
  const row = await queryOne<T>(sql, params);
  if (!row) throw new Error('Row not found');
  return row;
}

/** Execute INSERT/UPDATE/DELETE, return rowCount */
export async function execute(sql: string, params?: unknown[]): Promise<number> {
  const result = await getPool().query(sql, params);
  return result.rowCount ?? 0;
}

/** Close the pool */
export async function closePg(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/db/pg.ts
git commit -m "feat: add PostgreSQL connection pool wrapper"
```

---

## Task 5: Rewrite `db.ts` to Use PostgreSQL

**Files:**
- Modify: `packages/api/src/db/db.ts`

Replace the `better-sqlite3` implementation with re-exports from `pg.ts`. This way, all existing imports `from '../db/db'` continue to work — they just get async functions now.

- [ ] **Step 1: Rewrite `db.ts`**

Replace the entire file with:

```typescript
// db.ts — re-exports from PostgreSQL wrapper
// All existing imports { getDb } from '../db/db' should be replaced
// with { query, queryAll, queryOne, execute } from '../db/db'
export { getPool, initPg, runSchema, closePg, query, queryAll, queryOne, queryOneOrFail, execute } from './pg';
```

Keep the old `db.ts` as `db.sqlite.ts` for the migration script to use:

```bash
cp packages/api/src/db/db.ts packages/api/src/db/db.sqlite.ts
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/db/db.ts packages/api/src/db/db.sqlite.ts
git commit -m "refactor: rewrite db.ts to re-export PostgreSQL wrapper"
```

---

## Task 6: Update App Initialization

**Files:**
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Change init from sync SQLite to async PG**

Replace `initDb()` call with:

```typescript
import { initPg, runSchema } from './db/db';

// In the startup section, replace:
//   initDb();
// With:
async function startApp() {
  await initPg(config.databaseUrl);
  await runSchema();
  // ... rest of existing startup (app.listen, etc.)
}
startApp().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/index.ts
git commit -m "refactor: async PostgreSQL initialization on startup"
```

---

## Task 7: Convert Routes — Batch 1 (Heaviest: tasks, ai, goals, meetings)

**Files:**
- Modify: `packages/api/src/routes/tasks.ts`
- Modify: `packages/api/src/routes/ai.ts`
- Modify: `packages/api/src/routes/goals.ts`
- Modify: `packages/api/src/routes/meetings.ts`

For each file, apply these mechanical transformations:

1. Replace `import { getDb } from '../db/db'` → `import { query, queryAll, queryOne, execute } from '../db/db'`
2. Remove all `const db = getDb()` lines
3. Replace `db.prepare("...").all(...)` → `await queryAll("...", [...])`
4. Replace `db.prepare("...").get(...)` → `await queryOne("...", [...])`
5. Replace `db.prepare("...").run(...)` → `await execute("...", [...])`
6. Convert `?` placeholders to `$1, $2, $3...`
7. Replace `INSERT OR IGNORE` → `INSERT ... ON CONFLICT DO NOTHING`
8. Make route handlers `async` if not already
9. For `.run()` that uses `lastInsertRowid`, use `RETURNING id` instead:
   - `db.prepare("INSERT INTO tasks ...").run(...)` with `.lastInsertRowid`
   - → `const { rows } = await query("INSERT INTO tasks ... RETURNING id", [...])`

- [ ] **Step 1: Convert tasks.ts** (66 calls)

Example transformation pattern:
```typescript
// BEFORE (SQLite):
const db = getDb();
const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ?").get(id, userId) as Task;
db.prepare("UPDATE tasks SET title = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").run(title, id);
const { lastInsertRowid } = db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run(title, userId);

// AFTER (PostgreSQL):
const task = await queryOne<Task>("SELECT * FROM tasks WHERE id = $1 AND user_id = $2", [id, userId]);
await execute("UPDATE tasks SET title = $1, updated_at = NOW() WHERE id = $2", [title, id]);
const inserted = await queryOne<{id: number}>("INSERT INTO tasks (title, user_id) VALUES ($1, $2) RETURNING id", [title, userId]);
const newId = inserted!.id;
```

- [ ] **Step 2: Convert ai.ts** (88 calls)
- [ ] **Step 3: Convert goals.ts** (55 calls)
- [ ] **Step 4: Convert meetings.ts** (59 calls)
- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/tasks.ts packages/api/src/routes/ai.ts packages/api/src/routes/goals.ts packages/api/src/routes/meetings.ts
git commit -m "refactor: convert tasks/ai/goals/meetings routes to PostgreSQL"
```

---

## Task 8: Convert Routes — Batch 2 (Medium: widget, habits, auth, admin, documents, people, projects)

**Files:**
- Modify: `packages/api/src/routes/widget.ts` (38 calls)
- Modify: `packages/api/src/routes/habits.ts` (31 calls)
- Modify: `packages/api/src/routes/auth.ts` (34 calls)
- Modify: `packages/api/src/routes/admin.ts` (30 calls)
- Modify: `packages/api/src/routes/documents.ts` (31 calls)
- Modify: `packages/api/src/routes/people.ts` (30 calls)
- Modify: `packages/api/src/routes/projects.ts` (21 calls)

Same mechanical transformation as Task 7. Additional notes:

- `admin.ts`: Replace `fs.statSync(config.databasePath)` with a PG query for DB size: `SELECT pg_database_size('clarity_space')`
- `auth.ts`: `INSERT OR IGNORE INTO users` → `INSERT INTO users ... ON CONFLICT (email) DO NOTHING`
- `widget.ts`: All read-only queries, straightforward conversion

- [ ] **Step 1: Convert widget.ts**
- [ ] **Step 2: Convert habits.ts**
- [ ] **Step 3: Convert auth.ts**
- [ ] **Step 4: Convert admin.ts**
- [ ] **Step 5: Convert documents.ts**
- [ ] **Step 6: Convert people.ts**
- [ ] **Step 7: Convert projects.ts**
- [ ] **Step 8: Commit**

```bash
git add packages/api/src/routes/widget.ts packages/api/src/routes/habits.ts packages/api/src/routes/auth.ts packages/api/src/routes/admin.ts packages/api/src/routes/documents.ts packages/api/src/routes/people.ts packages/api/src/routes/projects.ts
git commit -m "refactor: convert widget/habits/auth/admin/docs/people/projects routes to PostgreSQL"
```

---

## Task 9: Convert Routes — Batch 3 (Small: export, google-cal, ideas, templates, tags, journal, search, claude-notes, email-webhook, ingest)

**Files:**
- Modify: `packages/api/src/routes/export.ts`
- Modify: `packages/api/src/routes/google-calendar.ts`
- Modify: `packages/api/src/routes/ideas.ts`
- Modify: `packages/api/src/routes/templates.ts`
- Modify: `packages/api/src/routes/tags.ts`
- Modify: `packages/api/src/routes/journal.ts`
- Modify: `packages/api/src/routes/search.ts`
- Modify: `packages/api/src/routes/claude-notes.ts`
- Modify: `packages/api/src/routes/email-webhook.ts`
- Modify: `packages/api/src/routes/ingest.ts`

Same mechanical transformation.

- [ ] **Step 1-10: Convert each file**
- [ ] **Step 11: Commit**

```bash
git add packages/api/src/routes/export.ts packages/api/src/routes/google-calendar.ts packages/api/src/routes/ideas.ts packages/api/src/routes/templates.ts packages/api/src/routes/tags.ts packages/api/src/routes/journal.ts packages/api/src/routes/search.ts packages/api/src/routes/claude-notes.ts packages/api/src/routes/email-webhook.ts packages/api/src/routes/ingest.ts
git commit -m "refactor: convert remaining routes to PostgreSQL"
```

---

## Task 10: Convert Services — Batch 1 (Heavy: telegram.service, notification.service)

**Files:**
- Modify: `packages/api/src/services/telegram.service.ts` (191 calls — largest file)
- Modify: `packages/api/src/services/notification.service.ts` (44 calls)

Same transformation patterns. Additional notes:

- `telegram.service.ts`: Many callback handlers. Each handler that uses DB must become async. Telegraf handlers already support async callbacks.
- `notification.service.ts`: Scheduled functions (setInterval callbacks) must be wrapped in async.

- [ ] **Step 1: Convert telegram.service.ts**
- [ ] **Step 2: Convert notification.service.ts**
- [ ] **Step 3: Commit**

```bash
git add packages/api/src/services/telegram.service.ts packages/api/src/services/notification.service.ts
git commit -m "refactor: convert telegram + notification services to PostgreSQL"
```

---

## Task 11: Convert Services — Batch 2 (Remaining)

**Files:**
- Modify: `packages/api/src/services/search.service.ts` (35 calls) — **FTS5 replacement here**
- Modify: `packages/api/src/services/ingest.service.ts` (28 calls)
- Modify: `packages/api/src/services/tools.service.ts` (15 calls)
- Modify: `packages/api/src/services/bundle.service.ts` (10 calls)
- Modify: `packages/api/src/services/obsidian-sync.service.ts` (12 calls)
- Modify: `packages/api/src/services/claude.service.ts` (3 calls)
- Modify: `packages/api/src/services/draft-session.ts` (5 calls)
- Modify: `packages/api/src/services/whisper-local.service.ts` (1 call)

Special attention for `search.service.ts` — replace FTS5 with PostgreSQL full-text search:

```typescript
// BEFORE (FTS5):
db.prepare("SELECT * FROM search_index WHERE search_index MATCH ? ORDER BY rank").all(query);
db.prepare("INSERT INTO search_index (type, ref_id, title, body) VALUES (?, ?, ?, ?)").run(...);
db.prepare("DELETE FROM search_index WHERE type = ? AND ref_id = ?").run(...);

// AFTER (PostgreSQL tsvector):
// Search — uses the search_vector column on tasks (auto-updated by trigger)
await queryAll(
  "SELECT id, title, ts_rank(search_vector, plainto_tsquery('russian', $1)) AS rank FROM tasks WHERE search_vector @@ plainto_tsquery('russian', $1) AND user_id = $2 ORDER BY rank DESC",
  [searchQuery, userId]
);
// Insert/update — trigger handles search_vector automatically, no manual index management needed
// Delete — CASCADE or just delete the row, trigger handles the rest
```

The `search_index` FTS5 virtual table is completely removed. The `search_vector` column on `tasks` is maintained by the trigger defined in `schema-pg.sql`. The `rebuildIndex()` function becomes a one-liner:

```typescript
export async function rebuildSearchIndex(): Promise<void> {
  await execute("UPDATE tasks SET search_vector = setweight(to_tsvector('russian', COALESCE(title, '')), 'A') || setweight(to_tsvector('russian', COALESCE(description, '')), 'B')");
}
```

- [ ] **Step 1: Convert search.service.ts** (FTS5 → tsvector)
- [ ] **Step 2: Convert ingest.service.ts**
- [ ] **Step 3: Convert tools.service.ts**
- [ ] **Step 4: Convert bundle.service.ts**
- [ ] **Step 5: Convert obsidian-sync.service.ts**
- [ ] **Step 6: Convert claude.service.ts**
- [ ] **Step 7: Convert draft-session.ts**
- [ ] **Step 8: Convert whisper-local.service.ts**
- [ ] **Step 9: Commit**

```bash
git add packages/api/src/services/*.ts
git commit -m "refactor: convert all services to PostgreSQL, replace FTS5 with tsvector"
```

---

## Task 12: Convert Auth Middleware + Scripts

**Files:**
- Modify: `packages/api/src/middleware/auth.ts`
- Modify: `packages/api/src/scripts/backfill-vault.ts`
- Modify: `packages/api/src/scripts/backfill-pro-summaries.ts`

- [ ] **Step 1: Convert auth.ts middleware**

The auth middleware likely does `db.prepare("SELECT ...").get()` to look up user by JWT token. Make it async:

```typescript
// Middleware must use async handler
export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  // ... JWT verification ...
  const user = await queryOne("SELECT * FROM users WHERE id = $1", [payload.id]);
  // ...
};
```

- [ ] **Step 2: Convert backfill scripts**
- [ ] **Step 3: Commit**

```bash
git add packages/api/src/middleware/auth.ts packages/api/src/scripts/*.ts
git commit -m "refactor: convert auth middleware and scripts to PostgreSQL"
```

---

## Task 13: Write Data Migration Script

**Files:**
- Create: `scripts/migrate-sqlite-to-pg.ts`

One-time script that reads all data from SQLite and writes to PostgreSQL.

- [ ] **Step 1: Write migration script**

```typescript
/**
 * One-time migration: SQLite → PostgreSQL
 * Run: npx tsx scripts/migrate-sqlite-to-pg.ts
 *
 * Prerequisites:
 * - PostgreSQL running with clarity_space database created
 * - schema-pg.sql already applied
 * - .env has both DATABASE_PATH (SQLite) and DATABASE_URL (PostgreSQL)
 */
import Database from 'better-sqlite3';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), 'packages/api/.env') });

const SQLITE_PATH = process.env['DATABASE_PATH'] || path.resolve(process.cwd(), 'data/pis.db');
const PG_URL = process.env['DATABASE_URL']!;

// Tables in dependency order (parents before children)
const TABLES_ORDERED = [
  'users',
  'projects',
  'tasks',
  'people',
  'meetings',
  'agreements',
  'ideas',
  'documents',
  'inbox_items',
  'task_people',
  'meeting_people',
  'people_projects',
  'meeting_projects',
  'claude_notes',
  'attachments',
  'habits',
  'habit_logs',
  'goals',
  'task_comments',
  'journal',
  'tags',
  'task_tags',
  'task_dependencies',
  'task_templates',
  'settings',
  'notification_log',
  'verification_codes',
  'refresh_tokens',
  'usage_logs',
];

async function migrate() {
  console.log('Opening SQLite:', SQLITE_PATH);
  const sqlite = new Database(SQLITE_PATH, { readonly: true });

  console.log('Connecting to PostgreSQL:', PG_URL.replace(/:[^@]+@/, ':***@'));
  const pg = new Pool({ connectionString: PG_URL });

  // Apply schema
  const schemaPath = path.resolve(__dirname, '../packages/api/src/db/schema-pg.sql');
  if (fs.existsSync(schemaPath)) {
    console.log('Applying schema...');
    await pg.query(fs.readFileSync(schemaPath, 'utf-8'));
  }

  for (const table of TABLES_ORDERED) {
    // Check if table exists in SQLite
    const exists = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
    if (!exists) {
      console.log(`  SKIP ${table} (not in SQLite)`);
      continue;
    }

    const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];
    if (rows.length === 0) {
      console.log(`  SKIP ${table} (0 rows)`);
      continue;
    }

    const columns = Object.keys(rows[0]!).filter(c => c !== 'search_vector');
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const colList = columns.map(c => `"${c}"`).join(', ');
    const insertSql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;

    let inserted = 0;
    for (const row of rows) {
      const values = columns.map(c => row[c] === undefined ? null : row[c]);
      try {
        await pg.query(insertSql, values);
        inserted++;
      } catch (err) {
        console.error(`  ERROR inserting into ${table}:`, (err as Error).message);
        console.error('  Row:', JSON.stringify(row).slice(0, 200));
      }
    }
    console.log(`  ${table}: ${inserted}/${rows.length} rows`);

    // Reset serial sequence
    if (columns.includes('id')) {
      await pg.query(`SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 0) + 1, false)`);
    }
  }

  // Rebuild search vectors
  console.log('Rebuilding search vectors...');
  await pg.query(`
    UPDATE tasks SET search_vector =
      setweight(to_tsvector('russian', COALESCE(title, '')), 'A') ||
      setweight(to_tsvector('russian', COALESCE(description, '')), 'B')
  `);

  // Verify counts
  console.log('\n=== Verification ===');
  for (const table of TABLES_ORDERED) {
    const exists = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
    if (!exists) continue;
    const sqliteCount = (sqlite.prepare(`SELECT COUNT(*) as c FROM "${table}"`).get() as { c: number }).c;
    const pgResult = await pg.query(`SELECT COUNT(*) as c FROM "${table}"`);
    const pgCount = parseInt(pgResult.rows[0].c);
    const match = sqliteCount === pgCount ? '✓' : '✗ MISMATCH';
    if (sqliteCount > 0) console.log(`  ${table}: SQLite=${sqliteCount} PG=${pgCount} ${match}`);
  }

  sqlite.close();
  await pg.end();
  console.log('\nMigration complete!');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add scripts/migrate-sqlite-to-pg.ts
git commit -m "feat: add SQLite to PostgreSQL data migration script"
```

---

## Task 14: Build + Fix TypeScript Errors

**Files:** all modified files

After converting all files, TypeScript compilation will likely have errors (missed async/await, type mismatches, etc.)

- [ ] **Step 1: Run TypeScript compiler**

```bash
cd packages/api && npx tsc --noEmit 2>&1 | head -100
```

- [ ] **Step 2: Fix all errors** — iterate until clean build
- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "fix: resolve TypeScript errors after PostgreSQL migration"
```

---

## Task 15: Local Testing

- [ ] **Step 1: Install PostgreSQL locally (or use Docker)**

```bash
docker run -d --name pg-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=clarity_space -p 5433:5432 postgres:16
```

- [ ] **Step 2: Set local DATABASE_URL**

```
DATABASE_URL=postgresql://postgres:test@localhost:5433/clarity_space
```

- [ ] **Step 3: Run the app**

```bash
cd packages/api && pnpm dev
```

- [ ] **Step 4: Smoke test API endpoints**

```bash
# Health check
curl http://localhost:3001/v1/widget/today?key=...
# Auth
curl -X POST http://localhost:3001/v1/auth/login -H 'Content-Type: application/json' -d '{"email":"test","password":"test"}'
# Tasks list
curl http://localhost:3001/v1/tasks -H 'Authorization: Bearer TOKEN'
```

- [ ] **Step 5: Run existing tests**

```bash
cd packages/api && pnpm test
```

- [ ] **Step 6: Fix any issues found**
- [ ] **Step 7: Commit fixes**

---

## Task 16: Nighttime Deployment

**Prerequisite:** All previous tasks completed, local tests passing.

- [ ] **Step 1: Backup SQLite file**

```bash
ssh root@clarity-space.ru "cp /var/www/kanban-app/data/pis.db /var/www/kanban-app/data/pis.db.backup-$(date +%Y%m%d)"
```

- [ ] **Step 2: Stop the service (downtime starts)**

```bash
ssh root@clarity-space.ru "source ~/.nvm/nvm.sh && nvm use 20 && pm2 stop kanban-api"
```

- [ ] **Step 3: Pull latest code**

```bash
ssh root@clarity-space.ru "cd /var/www/kanban-app && git pull"
```

- [ ] **Step 4: Install dependencies**

```bash
ssh root@clarity-space.ru "source ~/.nvm/nvm.sh && nvm use 20 && cd /var/www/kanban-app && pnpm install"
```

- [ ] **Step 5: Run migration script**

```bash
ssh root@clarity-space.ru "source ~/.nvm/nvm.sh && nvm use 20 && cd /var/www/kanban-app && npx tsx scripts/migrate-sqlite-to-pg.ts"
```

Verify output shows all tables migrated with matching counts.

- [ ] **Step 6: Build the API**

```bash
ssh root@clarity-space.ru "source ~/.nvm/nvm.sh && nvm use 20 && cd /var/www/kanban-app && pnpm --filter api build"
```

- [ ] **Step 7: Start the service**

```bash
ssh root@clarity-space.ru "source ~/.nvm/nvm.sh && nvm use 20 && cd /var/www/kanban-app && pm2 delete kanban-api && pm2 start packages/api/dist/index.js --name kanban-api"
```

- [ ] **Step 8: Smoke test production**

```bash
# API health
curl https://clarity-space.ru/v1/widget/today?key=pis_YOUR_WIDGET_KEY_HERE
# Check meetings
curl -s https://clarity-space.ru/v1/meetings -H 'Authorization: Bearer TOKEN' | head -200
```

- [ ] **Step 9: Set up daily PG backup cron**

```bash
ssh root@clarity-space.ru "echo '0 3 * * * sudo -u postgres pg_dump clarity_space | gzip > /var/backups/clarity_space_\$(date +\%Y\%m\%d).sql.gz' | crontab -"
```

- [ ] **Step 10: Downtime ends** — verify app works in browser and Telegram

---

## Task 17: Cleanup

- [ ] **Step 1: Remove better-sqlite3 dependency**

```bash
cd packages/api && pnpm remove better-sqlite3 @types/better-sqlite3
```

- [ ] **Step 2: Delete old SQLite files**

Delete:
- `packages/api/src/db/db.sqlite.ts`
- `packages/api/src/db/schema.sql`

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove SQLite dependency and old schema files"
```

---

## Rollback Procedure

If anything fails during deployment:

```bash
# 1. Stop broken service
ssh root@clarity-space.ru "source ~/.nvm/nvm.sh && nvm use 20 && pm2 stop kanban-api"

# 2. Revert to SQLite code
ssh root@clarity-space.ru "cd /var/www/kanban-app && git checkout HEAD~1"

# 3. Restart with SQLite
ssh root@clarity-space.ru "source ~/.nvm/nvm.sh && nvm use 20 && cd /var/www/kanban-app && pm2 delete kanban-api && pm2 start packages/api/dist/index.js --name kanban-api"
```

SQLite file is never modified during migration (opened as read-only). Zero data loss.
