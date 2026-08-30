# PostgreSQL Migration Design

## Summary

Migrate Clarity Space backend from SQLite (better-sqlite3, single file) to PostgreSQL for multi-user SaaS readiness. All existing data preserved. Planned nighttime deployment with ~30 min downtime.

## Context

- **Current state**: SQLite file at `/var/www/kanban-app/data/pis.db`, accessed via `better-sqlite3` with raw SQL
- **Server**: clarity-space.ru (213.139.229.148), 16GB RAM, Ubuntu 24.04
- **Tables**: ~30 tables, ~100 ad-hoc migrations in `db.ts`
- **Users**: 1 active user now, SaaS multi-user planned
- **Search**: FTS5 virtual table `search_index` with `unicode61` tokenizer

## Decision Log

| Question | Decision | Rationale |
|----------|----------|-----------|
| Downtime acceptable? | Yes, nighttime ~30 min | Single user, not mission-critical 24/7 |
| Where to install PG? | Same server (clarity-space.ru) | 16GB RAM sufficient, no network latency; easy to move later |
| Full-text search | PostgreSQL `tsvector/tsquery` with `russian` config | Native Russian stemming, no extra services |
| ORM / query layer | Raw SQL via `node-postgres` (pg) | Minimal changes from current `better-sqlite3` raw SQL |
| Data migration | Full transfer, all tables and data | Real data (meetings, documents, passwords) must be preserved |

## Architecture

### Before
```
App → better-sqlite3 → /data/pis.db (file)
```

### After
```
App → node-postgres (pg.Pool) → PostgreSQL service (localhost:5432)
```

### Database Layer Changes

**File: `packages/api/src/db/db.ts`** — the core change

Current interface (synchronous, better-sqlite3):
```typescript
const db = getDb();
db.prepare("SELECT * FROM tasks WHERE user_id = ?").all(userId);
db.prepare("INSERT INTO tasks (title) VALUES (?)").run(title);
```

New interface (async, node-postgres):
```typescript
const pool = getPool();
await pool.query("SELECT * FROM tasks WHERE user_id = $1", [userId]);
await pool.query("INSERT INTO tasks (title) VALUES ($1)", [title]);
```

Key syntax changes across all queries:
- `?` placeholders → `$1, $2, $3...` (positional)
- `.prepare().run()` → `await pool.query()`
- `.prepare().all()` → `(await pool.query()).rows`
- `.prepare().get()` → `(await pool.query()).rows[0]`
- All DB calls become `async/await` (routes already async in Express)
- `INTEGER PRIMARY KEY` → `SERIAL PRIMARY KEY`
- `strftime('%Y-%m-%dT%H:%M:%SZ','now')` → `NOW()` or `CURRENT_TIMESTAMP`
- `INSERT OR IGNORE` → `INSERT ... ON CONFLICT DO NOTHING`
- SQLite `sqlite_master` introspection → `information_schema.columns`
- `PRAGMA foreign_keys` → always on by default in PG
- `PRAGMA journal_mode = WAL` → not needed (PG has its own WAL)

### Schema Translation

**Standard tables** (~25 tables): straightforward conversion
- `INTEGER` → `INTEGER` (or `SERIAL` for auto-increment PKs)
- `TEXT` → `TEXT`
- `REAL` → `DOUBLE PRECISION`
- `BOOLEAN` (stored as 0/1 in SQLite) → `BOOLEAN` (native)
- `CHECK` constraints → same syntax, works in PG
- `UNIQUE` constraints → same syntax
- Composite `PRIMARY KEY` on junction tables → same syntax

**FTS5 virtual table → PostgreSQL full-text search**:
- Drop `search_index` virtual table
- Add `search_vector TSVECTOR` column to `tasks` table (and any other searchable tables)
- Create `GIN` index on `search_vector`
- Create trigger to auto-update `search_vector` on INSERT/UPDATE
- Use `ts_rank()` + `plainto_tsquery('russian', ...)` for search queries
- Russian stemming config: `'russian'` dictionary built-in

**Settings table recreation**: currently has a complex migration that recreates the table with composite PK `(key, user_id)`. In PG, just define it correctly from the start.

**Tasks table CHECK constraint**: SQLite required table recreation to add `'someday'` status. In PG, `ALTER TYPE` or just use TEXT without CHECK (or define CHECK with all values from start).

### Migration Script

A one-time Node.js script (`scripts/migrate-to-pg.ts`):

1. Connect to SQLite (read-only) and PostgreSQL
2. Create all tables in PG with correct schema
3. For each table, read all rows from SQLite → batch INSERT into PG
4. Reset all `SERIAL` sequences to `MAX(id) + 1`
5. Create indexes (including GIN for full-text search)
6. Populate `search_vector` columns from existing data
7. Verify row counts match between SQLite and PG

### Connection Management

```typescript
// db-postgres.ts
import { Pool } from 'pg';

let pool: Pool | null = null;

export function initPool(): Pool {
  pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'clarity_space',
    user: 'clarity',
    password: process.env.PG_PASSWORD,
    max: 20,           // connection pool size
    idleTimeoutMillis: 30000,
  });
  return pool;
}

export function getPool(): Pool {
  if (!pool) throw new Error('DB pool not initialized');
  return pool;
}
```

### Config Changes

Add to `.env` / config:
```
DATABASE_URL=postgresql://clarity:PASSWORD@localhost:5432/clarity_space
```

Keep `config.databasePath` for backward compatibility during transition (points to SQLite for migration script).

## Implementation Phases

### Phase 1: PostgreSQL Setup (on server)
- Install PostgreSQL 16
- Create database `clarity_space`, user `clarity`
- Configure `pg_hba.conf` for local access
- Set password in environment

### Phase 2: New DB Layer
- Create `db-postgres.ts` with Pool wrapper
- Create `schema-postgres.sql` with all tables (PG syntax)
- Helper functions: `query()`, `queryOne()`, `queryAll()`

### Phase 3: Migrate All Routes
- Update every file that imports from `db/db` to use async queries
- Change all `db.prepare(...).run/all/get()` to `await pool.query()`
- Change `?` to `$1, $2...` in all SQL strings
- Update services: `telegram.service.ts`, `notification.service.ts`, `bundle.service.ts`, etc.

### Phase 4: Full-Text Search
- Add `search_vector` column + GIN index
- Create trigger for auto-update
- Update search route to use `tsquery`

### Phase 5: Migration Script
- Write `scripts/migrate-to-pg.ts`
- Test on copy of production data locally
- Verify all row counts and data integrity

### Phase 6: Nighttime Deployment
1. `pm2 stop kanban-api` (downtime starts)
2. Copy latest `pis.db` as backup
3. Run migration script
4. Update `.env` with PG connection
5. `pm2 delete kanban-api && pm2 start` with new config
6. Verify API responds correctly
7. Smoke test: check meetings, tasks, documents
8. Downtime ends (~30 min total)

### Phase 7: Cleanup
- Remove `better-sqlite3` dependency
- Remove old `db.ts` and `schema.sql`
- Set up PG daily backups (`pg_dump` cron)

## Rollback Plan

If migration fails:
1. Stop new kanban-api
2. Restore old code (git checkout)
3. `pm2 start` with SQLite config
4. SQLite file is untouched (read-only during migration)

Zero data loss guaranteed — SQLite file is never modified during migration.

## Risks

| Risk | Mitigation |
|------|------------|
| Sync → async conversion breaks something | Test each route individually |
| Data loss during transfer | Verify row counts, keep SQLite backup |
| PostgreSQL OOM on 16GB server | PG uses ~200-300MB, plenty of headroom |
| FTS quality regression | Test Russian search queries before/after |
| Downtime exceeds 30 min | Practice migration on local copy first |

## Files to Modify

**Core (must change)**:
- `packages/api/src/db/db.ts` → rewrite to `db-postgres.ts`
- `packages/api/src/db/schema.sql` → `schema-postgres.sql`
- All files in `packages/api/src/routes/` (~15 files)
- All files in `packages/api/src/services/` (~8 files)
- `packages/api/src/middleware/auth.ts`
- `packages/api/src/config.ts` (add PG config)
- `packages/api/package.json` (add `pg`, remove `better-sqlite3`)

**New files**:
- `packages/api/src/db/db-postgres.ts`
- `packages/api/src/db/schema-postgres.sql`
- `scripts/migrate-to-pg.ts`

**No changes**:
- Frontend (`apps/web/`) — zero changes
- Shared package (`packages/shared/`) — zero changes
- Telegram bot logic — same API, just async DB calls
- Nginx config — unchanged
- PM2 config — just restart
