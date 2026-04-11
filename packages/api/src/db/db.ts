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
  // Add order_index if not exists (migration)
  try { _db.exec('ALTER TABLE projects ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0'); } catch {}
  // Add project_id to people if not exists (migration)
  try { _db.exec('ALTER TABLE people ADD COLUMN project_id INTEGER REFERENCES projects(id)'); } catch {}
  // Create people_projects junction table
  try { _db.exec('CREATE TABLE IF NOT EXISTS people_projects (person_id INTEGER NOT NULL REFERENCES people(id), project_id INTEGER NOT NULL REFERENCES projects(id), PRIMARY KEY (person_id, project_id))'); } catch {}
  // Migrate existing project_id data to junction table
  try { _db.exec("INSERT OR IGNORE INTO people_projects (person_id, project_id) SELECT id, project_id FROM people WHERE project_id IS NOT NULL"); } catch {}
  // Migration: allow 'someday' status (SQLite can't alter CHECK constraints, recreate table)
  try {
    const hasCheck = _db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'").get() as { sql: string } | undefined;
    if (hasCheck && !hasCheck.sql.includes("'someday'")) {
      _db.exec(`
        PRAGMA foreign_keys = OFF;
        ALTER TABLE tasks RENAME TO tasks_old;
        CREATE TABLE tasks (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id  INTEGER REFERENCES projects(id),
          title       TEXT    NOT NULL,
          description TEXT    NOT NULL DEFAULT '',
          status      TEXT    NOT NULL DEFAULT 'backlog'
                        CHECK(status IN ('backlog','todo','in_progress','done','someday')),
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
        INSERT INTO tasks SELECT * FROM tasks_old;
        DROP TABLE tasks_old;
        PRAGMA foreign_keys = ON;
      `);
    }
  } catch {}
  // Create FTS5 search index
  try {
    _db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
        type,
        ref_id UNINDEXED,
        title,
        body,
        tokenize='unicode61'
      )
    `);
  } catch {}

  // Claude notes — queue for Claude Code processing
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS claude_notes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        content    TEXT    NOT NULL,
        source     TEXT    NOT NULL DEFAULT 'telegram',
        processed  INTEGER NOT NULL DEFAULT 0,
        vault_path TEXT,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);
  } catch {}

  // Meeting-projects junction (many-to-many)
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS meeting_projects (
        meeting_id INTEGER NOT NULL REFERENCES meetings(id),
        project_id INTEGER NOT NULL REFERENCES projects(id),
        PRIMARY KEY (meeting_id, project_id)
      )
    `);
    _db.exec("INSERT OR IGNORE INTO meeting_projects (meeting_id, project_id) SELECT id, project_id FROM meetings WHERE project_id IS NOT NULL");
  } catch {}

  // Ideas status column
  try { _db.exec("ALTER TABLE ideas ADD COLUMN status TEXT NOT NULL DEFAULT 'backlog'"); } catch {}
  try { _db.exec("ALTER TABLE ideas ADD COLUMN archived INTEGER NOT NULL DEFAULT 0"); } catch {}

  // People: ASAP flag
  try { _db.exec("ALTER TABLE people ADD COLUMN meet_asap INTEGER NOT NULL DEFAULT 0"); } catch {}

  // Documents: status column
  try { _db.exec("ALTER TABLE documents ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'"); } catch {}

  // Tasks: parent_id for subtasks
  try { _db.exec("ALTER TABLE tasks ADD COLUMN parent_id INTEGER REFERENCES tasks(id)"); } catch {}

  // Attachments table
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS attachments (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id   INTEGER REFERENCES documents(id),
        task_id       INTEGER REFERENCES tasks(id),
        meeting_id    INTEGER REFERENCES meetings(id),
        filename      TEXT NOT NULL,
        original_name TEXT NOT NULL,
        size          INTEGER NOT NULL DEFAULT 0,
        mime_type     TEXT NOT NULL DEFAULT '',
        created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);
  } catch {}

  // Habits tracker
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS habits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        icon TEXT NOT NULL DEFAULT '✅',
        color TEXT NOT NULL DEFAULT '#6366f1',
        frequency TEXT NOT NULL DEFAULT 'daily',
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS habit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        habit_id INTEGER NOT NULL REFERENCES habits(id),
        date TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 1,
        UNIQUE(habit_id, date)
      )
    `);
  } catch {}

  // Goals / OKR table
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS goals (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        title         TEXT NOT NULL,
        description   TEXT NOT NULL DEFAULT '',
        type          TEXT NOT NULL DEFAULT 'goal',
        parent_id     INTEGER REFERENCES goals(id),
        project_id    INTEGER REFERENCES projects(id),
        target_value  REAL,
        current_value REAL NOT NULL DEFAULT 0,
        unit          TEXT NOT NULL DEFAULT '%',
        due_date      TEXT,
        status        TEXT NOT NULL DEFAULT 'active',
        created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);
  } catch {}

  // Task comments
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS task_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL REFERENCES tasks(id),
        text TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);
  } catch {}

  // Journal / daily notes
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS journal (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        focus TEXT NOT NULL DEFAULT '',
        gratitude TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        results TEXT NOT NULL DEFAULT '',
        mood INTEGER NOT NULL DEFAULT 3,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);
  } catch {}

  // Recurring tasks
  try { _db.exec('ALTER TABLE tasks ADD COLUMN recurrence TEXT'); } catch {}

  // Tags / Labels
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL DEFAULT '#6366f1'
      )
    `);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS task_tags (
        task_id INTEGER NOT NULL REFERENCES tasks(id),
        tag_id INTEGER NOT NULL REFERENCES tags(id),
        PRIMARY KEY (task_id, tag_id)
      )
    `);
  } catch {}

  // Task dependencies
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS task_dependencies (
        task_id INTEGER NOT NULL REFERENCES tasks(id),
        depends_on_id INTEGER NOT NULL REFERENCES tasks(id),
        PRIMARY KEY (task_id, depends_on_id)
      )
    `);
  } catch {}

  // Task templates
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS task_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        priority INTEGER NOT NULL DEFAULT 3,
        project_id INTEGER REFERENCES projects(id),
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);
  } catch {}
}

export function initTestDb(): void {
  _db = new Database(':memory:');
  _db.pragma('foreign_keys = ON');

  const schema = fs.readFileSync(
    path.resolve(__dirname, 'schema.sql'),
    'utf-8'
  );
  _db.exec(schema);
  // Add order_index if not exists (migration)
  try { _db.exec('ALTER TABLE projects ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0'); } catch {}
  // Add project_id to people if not exists (migration)
  try { _db.exec('ALTER TABLE people ADD COLUMN project_id INTEGER REFERENCES projects(id)'); } catch {}
  // Create people_projects junction table
  try { _db.exec('CREATE TABLE IF NOT EXISTS people_projects (person_id INTEGER NOT NULL REFERENCES people(id), project_id INTEGER NOT NULL REFERENCES projects(id), PRIMARY KEY (person_id, project_id))'); } catch {}
  // Migrate existing project_id data to junction table
  try { _db.exec("INSERT OR IGNORE INTO people_projects (person_id, project_id) SELECT id, project_id FROM people WHERE project_id IS NOT NULL"); } catch {}
  // Create FTS5 search index
  try {
    _db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
        type,
        ref_id UNINDEXED,
        title,
        body,
        tokenize='unicode61'
      )
    `);
  } catch {}

  // Claude notes — queue for Claude Code processing
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS claude_notes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        content    TEXT    NOT NULL,
        source     TEXT    NOT NULL DEFAULT 'telegram',
        processed  INTEGER NOT NULL DEFAULT 0,
        vault_path TEXT,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);
  } catch {}

  // Meeting-projects junction (many-to-many)
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS meeting_projects (
        meeting_id INTEGER NOT NULL REFERENCES meetings(id),
        project_id INTEGER NOT NULL REFERENCES projects(id),
        PRIMARY KEY (meeting_id, project_id)
      )
    `);
    _db.exec("INSERT OR IGNORE INTO meeting_projects (meeting_id, project_id) SELECT id, project_id FROM meetings WHERE project_id IS NOT NULL");
  } catch {}

  // Ideas status column
  try { _db.exec("ALTER TABLE ideas ADD COLUMN status TEXT NOT NULL DEFAULT 'backlog'"); } catch {}
  try { _db.exec("ALTER TABLE ideas ADD COLUMN archived INTEGER NOT NULL DEFAULT 0"); } catch {}

  // People: ASAP flag
  try { _db.exec("ALTER TABLE people ADD COLUMN meet_asap INTEGER NOT NULL DEFAULT 0"); } catch {}

  // Documents: status column
  try { _db.exec("ALTER TABLE documents ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'"); } catch {}

  // Tasks: parent_id for subtasks
  try { _db.exec("ALTER TABLE tasks ADD COLUMN parent_id INTEGER REFERENCES tasks(id)"); } catch {}

  // Attachments table
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS attachments (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id   INTEGER REFERENCES documents(id),
        task_id       INTEGER REFERENCES tasks(id),
        meeting_id    INTEGER REFERENCES meetings(id),
        filename      TEXT NOT NULL,
        original_name TEXT NOT NULL,
        size          INTEGER NOT NULL DEFAULT 0,
        mime_type     TEXT NOT NULL DEFAULT '',
        created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);
  } catch {}

  // Habits tracker
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS habits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        icon TEXT NOT NULL DEFAULT '✅',
        color TEXT NOT NULL DEFAULT '#6366f1',
        frequency TEXT NOT NULL DEFAULT 'daily',
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS habit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        habit_id INTEGER NOT NULL REFERENCES habits(id),
        date TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 1,
        UNIQUE(habit_id, date)
      )
    `);
  } catch {}

  // Goals / OKR table
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS goals (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        title         TEXT NOT NULL,
        description   TEXT NOT NULL DEFAULT '',
        type          TEXT NOT NULL DEFAULT 'goal',
        parent_id     INTEGER REFERENCES goals(id),
        project_id    INTEGER REFERENCES projects(id),
        target_value  REAL,
        current_value REAL NOT NULL DEFAULT 0,
        unit          TEXT NOT NULL DEFAULT '%',
        due_date      TEXT,
        status        TEXT NOT NULL DEFAULT 'active',
        created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);
  } catch {}

  // Task comments
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS task_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL REFERENCES tasks(id),
        text TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);
  } catch {}

  // Journal / daily notes
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS journal (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        focus TEXT NOT NULL DEFAULT '',
        gratitude TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        results TEXT NOT NULL DEFAULT '',
        mood INTEGER NOT NULL DEFAULT 3,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);
  } catch {}

  // Recurring tasks
  try { _db.exec('ALTER TABLE tasks ADD COLUMN recurrence TEXT'); } catch {}

  // Tags / Labels
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL DEFAULT '#6366f1'
      )
    `);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS task_tags (
        task_id INTEGER NOT NULL REFERENCES tasks(id),
        tag_id INTEGER NOT NULL REFERENCES tags(id),
        PRIMARY KEY (task_id, tag_id)
      )
    `);
  } catch {}

  // Task dependencies
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS task_dependencies (
        task_id INTEGER NOT NULL REFERENCES tasks(id),
        depends_on_id INTEGER NOT NULL REFERENCES tasks(id),
        PRIMARY KEY (task_id, depends_on_id)
      )
    `);
  } catch {}

  // Task templates
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS task_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        priority INTEGER NOT NULL DEFAULT 3,
        project_id INTEGER REFERENCES projects(id),
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);
  } catch {}
}

export function closeDb(): void {
  _db?.close();
  _db = null;
}
