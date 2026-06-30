import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import * as os from 'node:os';
import * as path from 'node:path';

// We need to test db functions directly, so inline a fresh db setup
// since getDb uses a singleton that would conflict across tests
function freshDb(): Database.Database {
  const p = path.join(os.tmpdir(), `forge-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = new Database(p);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      tg_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      allowed INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      project_name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'CREATED',
      model TEXT NOT NULL DEFAULT 'sonnet',
      target TEXT NOT NULL DEFAULT 'server',
      worktree_path TEXT, branch TEXT, plan TEXT,
      result_summary TEXT, diff_stat TEXT, test_result TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT, duration_ms INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(tg_id)
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );
  `);
  return db;
}

describe('db', () => {
  it('creates tables on init', () => {
    const db = freshDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('tasks');
    expect(names).toContain('events');
    expect(names).toContain('users');
  });

  it('inserts and retrieves a task', () => {
    const db = freshDb();
    db.prepare('INSERT INTO users (tg_id, name) VALUES (?, ?)').run(123, 'test');
    const info = db.prepare('INSERT INTO tasks (user_id, project_name, prompt, model, target) VALUES (?, ?, ?, ?, ?)').run(123, 'myapp', 'fix bug', 'sonnet', 'server');
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid) as any;
    expect(task.id).toBeGreaterThan(0);
    expect(task.state).toBe('CREATED');
    expect(task.prompt).toBe('fix bug');
  });

  it('updates task state', () => {
    const db = freshDb();
    db.prepare('INSERT INTO users (tg_id, name) VALUES (?, ?)').run(123, 'test');
    const info = db.prepare('INSERT INTO tasks (user_id, project_name, prompt, model, target) VALUES (?, ?, ?, ?, ?)').run(123, 'myapp', 'fix', 'sonnet', 'server');
    db.prepare('UPDATE tasks SET state = ? WHERE id = ?').run('PLANNING', info.lastInsertRowid);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid) as any;
    expect(task.state).toBe('PLANNING');
  });

  it('tracks active tasks (excludes DONE)', () => {
    const db = freshDb();
    db.prepare('INSERT INTO users (tg_id, name) VALUES (?, ?)').run(123, 'test');
    db.prepare('INSERT INTO tasks (user_id, project_name, prompt, model, target) VALUES (?, ?, ?, ?, ?)').run(123, 'a', 'x', 'sonnet', 'server');
    db.prepare('INSERT INTO tasks (user_id, project_name, prompt, model, target) VALUES (?, ?, ?, ?, ?)').run(123, 'b', 'y', 'sonnet', 'server');
    const info3 = db.prepare('INSERT INTO tasks (user_id, project_name, prompt, model, target) VALUES (?, ?, ?, ?, ?)').run(123, 'c', 'z', 'sonnet', 'server');
    db.prepare('UPDATE tasks SET state = ? WHERE id = ?').run('DONE', info3.lastInsertRowid);
    const active = db.prepare("SELECT * FROM tasks WHERE user_id = ? AND state NOT IN ('DONE', 'FAILED', 'REJECTED')").all(123) as any[];
    expect(active.length).toBe(2);
  });

  it('records and retrieves events', () => {
    const db = freshDb();
    db.prepare('INSERT INTO users (tg_id, name) VALUES (?, ?)').run(123, 'test');
    const info = db.prepare('INSERT INTO tasks (user_id, project_name, prompt, model, target) VALUES (?, ?, ?, ?, ?)').run(123, 'a', 'x', 'sonnet', 'server');
    const taskId = info.lastInsertRowid as number;
    db.prepare('INSERT INTO events (task_id, type, payload) VALUES (?, ?, ?)').run(taskId, 'state_change', JSON.stringify({ from: 'CREATED', to: 'PLANNING' }));
    db.prepare('INSERT INTO events (task_id, type, payload) VALUES (?, ?, ?)').run(taskId, 'log', JSON.stringify({ text: 'working...' }));
    const events = db.prepare('SELECT * FROM events WHERE task_id = ? ORDER BY id').all(taskId) as any[];
    expect(events.length).toBe(2);
    expect(events[0].type).toBe('state_change');
  });
});
