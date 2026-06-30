import Database from 'better-sqlite3';
import * as path from 'node:path';

let _db: Database.Database | null = null;

export function getDb(dbPath: string): Database.Database {
  if (_db) return _db;
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  migrate(_db);
  return _db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      tg_id       INTEGER PRIMARY KEY,
      name        TEXT NOT NULL DEFAULT '',
      allowed     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL,
      project_name    TEXT NOT NULL,
      prompt          TEXT NOT NULL,
      state           TEXT NOT NULL DEFAULT 'CREATED',
      model           TEXT NOT NULL DEFAULT 'sonnet',
      target          TEXT NOT NULL DEFAULT 'server',
      worktree_path   TEXT,
      branch          TEXT,
      plan            TEXT,
      result_summary  TEXT,
      diff_stat       TEXT,
      test_result     TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at     TEXT,
      duration_ms     INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(tg_id)
    );

    CREATE TABLE IF NOT EXISTS events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id     INTEGER NOT NULL,
      type        TEXT NOT NULL,
      payload     TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state);
    CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id);
  `);
}

export interface TaskRow {
  id: number;
  user_id: number;
  project_name: string;
  prompt: string;
  state: string;
  model: string;
  target: string;
  worktree_path: string | null;
  branch: string | null;
  plan: string | null;
  result_summary: string | null;
  diff_stat: string | null;
  test_result: string | null;
  created_at: string;
  finished_at: string | null;
  duration_ms: number | null;
}

export function createTask(db: Database.Database, task: {
  user_id: number;
  project_name: string;
  prompt: string;
  model: string;
  target: string;
}): TaskRow {
  const stmt = db.prepare(`
    INSERT INTO tasks (user_id, project_name, prompt, model, target)
    VALUES (@user_id, @project_name, @prompt, @model, @target)
  `);
  const info = stmt.run(task);
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid) as TaskRow;
}

export function updateTask(db: Database.Database, id: number, fields: Partial<TaskRow>): void {
  const allowed = ['state', 'worktree_path', 'branch', 'plan', 'result_summary', 'diff_stat', 'test_result', 'finished_at', 'duration_ms'];
  const entries = Object.entries(fields).filter(([k]) => allowed.includes(k));
  if (entries.length === 0) return;
  const sets = entries.map(([k]) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE tasks SET ${sets} WHERE id = @id`).run({ id, ...Object.fromEntries(entries) });
}

export function getTask(db: Database.Database, id: number): TaskRow | undefined {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
}

export function getActiveTasks(db: Database.Database, userId: number): TaskRow[] {
  return db.prepare(
    "SELECT * FROM tasks WHERE user_id = ? AND state NOT IN ('DONE', 'FAILED', 'REJECTED') ORDER BY id DESC"
  ).all(userId) as TaskRow[];
}

export function getRecentTasks(db: Database.Database, userId: number, limit = 20): TaskRow[] {
  return db.prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit) as TaskRow[];
}

export function addEvent(db: Database.Database, taskId: number, type: string, payload?: unknown): void {
  db.prepare('INSERT INTO events (task_id, type, payload) VALUES (?, ?, ?)').run(
    taskId, type, payload ? JSON.stringify(payload) : null
  );
}

export function getEvents(db: Database.Database, taskId: number): Array<{ id: number; type: string; payload: string | null; created_at: string }> {
  return db.prepare('SELECT * FROM events WHERE task_id = ? ORDER BY id').all(taskId) as any[];
}

export function ensureUser(db: Database.Database, tgId: number, name: string): void {
  db.prepare('INSERT OR IGNORE INTO users (tg_id, name) VALUES (?, ?)').run(tgId, name);
}
