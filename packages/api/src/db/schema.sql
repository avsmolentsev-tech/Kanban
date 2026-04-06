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
