-- PostgreSQL schema for Clarity Space
-- This is the complete final schema with all migrations applied.
-- Converted from SQLite schema.sql + all migrations in db.ts

-- ─── Users ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  email          TEXT    NOT NULL UNIQUE,
  password_hash  TEXT    NOT NULL DEFAULT '',
  name           TEXT    NOT NULL DEFAULT '',
  role           TEXT    NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
  email_verified INTEGER NOT NULL DEFAULT 0,
  tg_id          TEXT    UNIQUE,
  created_at     TEXT    NOT NULL DEFAULT NOW()
);

-- ─── Projects ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS projects (
  id          SERIAL PRIMARY KEY,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'active'
                CHECK(status IN ('active','paused','completed','archived')),
  color       TEXT    NOT NULL DEFAULT '#6366f1',
  vault_path  TEXT,
  created_at  TEXT    NOT NULL DEFAULT NOW(),
  updated_at  TEXT    NOT NULL DEFAULT NOW(),
  archived    INTEGER NOT NULL DEFAULT 0,
  order_index INTEGER NOT NULL DEFAULT 0,
  user_id     INTEGER REFERENCES users(id)
);

-- ─── Tasks ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tasks (
  id             SERIAL PRIMARY KEY,
  project_id     INTEGER REFERENCES projects(id),
  title          TEXT    NOT NULL,
  description    TEXT    NOT NULL DEFAULT '',
  status         TEXT    NOT NULL DEFAULT 'backlog'
                   CHECK(status IN ('backlog','todo','in_progress','done','someday')),
  priority       INTEGER NOT NULL DEFAULT 3 CHECK(priority BETWEEN 1 AND 5),
  urgency        INTEGER NOT NULL DEFAULT 3 CHECK(urgency BETWEEN 1 AND 5),
  due_date       TEXT,
  start_date     TEXT,
  vault_path     TEXT,
  created_at     TEXT    NOT NULL DEFAULT NOW(),
  updated_at     TEXT    NOT NULL DEFAULT NOW(),
  archived       INTEGER NOT NULL DEFAULT 0,
  order_index    INTEGER NOT NULL DEFAULT 0,
  parent_id      INTEGER REFERENCES tasks(id),
  recurrence     TEXT,
  revenue_impact DOUBLE PRECISION,
  goal_id        INTEGER,
  user_id        INTEGER REFERENCES users(id),
  search_vector  TSVECTOR
);

-- ─── People ──────────────────────────────────────────────────────────────────

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
  created_at TEXT NOT NULL DEFAULT NOW(),
  updated_at TEXT NOT NULL DEFAULT NOW(),
  project_id INTEGER REFERENCES projects(id),
  meet_asap  INTEGER NOT NULL DEFAULT 0,
  user_id    INTEGER REFERENCES users(id)
);

-- ─── Meetings ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meetings (
  id                 SERIAL PRIMARY KEY,
  title              TEXT    NOT NULL,
  date               TEXT    NOT NULL,
  project_id         INTEGER REFERENCES projects(id),
  summary_raw        TEXT    NOT NULL DEFAULT '',
  summary_structured TEXT,
  vault_path         TEXT,
  source_file        TEXT,
  processed          INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT    NOT NULL DEFAULT NOW(),
  sync_vault         INTEGER NOT NULL DEFAULT 1,
  updated_at         TEXT,
  processing_status  TEXT,
  processing_error   TEXT,
  goal_id            INTEGER,
  user_id            INTEGER REFERENCES users(id)
);

-- ─── Agreements ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agreements (
  id          SERIAL PRIMARY KEY,
  meeting_id  INTEGER NOT NULL REFERENCES meetings(id),
  task_id     INTEGER REFERENCES tasks(id),
  person_id   INTEGER REFERENCES people(id),
  description TEXT    NOT NULL,
  due_date    TEXT,
  status      TEXT    NOT NULL DEFAULT 'open'
                CHECK(status IN ('open','done','cancelled')),
  created_at  TEXT    NOT NULL DEFAULT NOW()
);

-- ─── Ideas ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ideas (
  id                SERIAL PRIMARY KEY,
  title             TEXT NOT NULL,
  body              TEXT NOT NULL DEFAULT '',
  category          TEXT NOT NULL DEFAULT 'personal'
                      CHECK(category IN ('business','product','personal','growth')),
  project_id        INTEGER REFERENCES projects(id),
  source_meeting_id INTEGER REFERENCES meetings(id),
  vault_path        TEXT,
  created_at        TEXT NOT NULL DEFAULT NOW(),
  status            TEXT NOT NULL DEFAULT 'backlog',
  archived          INTEGER NOT NULL DEFAULT 0,
  user_id           INTEGER REFERENCES users(id)
);

-- ─── Inbox items ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inbox_items (
  id                SERIAL PRIMARY KEY,
  original_filename TEXT NOT NULL,
  original_path     TEXT,
  file_type         TEXT NOT NULL,
  extracted_text    TEXT,
  processed         INTEGER NOT NULL DEFAULT 0,
  target_type       TEXT,
  target_id         INTEGER,
  created_at        TEXT NOT NULL DEFAULT NOW(),
  error             TEXT
);

-- ─── Junction: task_people ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_people (
  task_id   INTEGER NOT NULL REFERENCES tasks(id),
  person_id INTEGER NOT NULL REFERENCES people(id),
  PRIMARY KEY (task_id, person_id)
);

-- ─── Junction: meeting_people ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meeting_people (
  meeting_id INTEGER NOT NULL REFERENCES meetings(id),
  person_id  INTEGER NOT NULL REFERENCES people(id),
  PRIMARY KEY (meeting_id, person_id)
);

-- ─── Junction: people_projects ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS people_projects (
  person_id  INTEGER NOT NULL REFERENCES people(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  PRIMARY KEY (person_id, project_id)
);

-- ─── Junction: meeting_projects ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meeting_projects (
  meeting_id INTEGER NOT NULL REFERENCES meetings(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  PRIMARY KEY (meeting_id, project_id)
);

-- ─── Documents ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS documents (
  id         SERIAL PRIMARY KEY,
  title      TEXT    NOT NULL,
  body       TEXT    NOT NULL DEFAULT '',
  project_id INTEGER REFERENCES projects(id),
  category   TEXT    NOT NULL DEFAULT 'note'
               CHECK(category IN ('note','reference','template','archive')),
  vault_path TEXT,
  created_at TEXT    NOT NULL DEFAULT NOW(),
  updated_at TEXT    NOT NULL DEFAULT NOW(),
  status     TEXT    NOT NULL DEFAULT 'draft',
  parent_id  INTEGER REFERENCES documents(id),
  user_id    INTEGER REFERENCES users(id)
);

-- ─── Attachments ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS attachments (
  id            SERIAL PRIMARY KEY,
  document_id   INTEGER REFERENCES documents(id),
  task_id       INTEGER REFERENCES tasks(id),
  meeting_id    INTEGER REFERENCES meetings(id),
  filename      TEXT NOT NULL,
  original_name TEXT NOT NULL,
  size          INTEGER NOT NULL DEFAULT 0,
  mime_type     TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT NOW()
);

-- ─── Claude notes ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS claude_notes (
  id         SERIAL PRIMARY KEY,
  content    TEXT    NOT NULL,
  source     TEXT    NOT NULL DEFAULT 'telegram',
  processed  INTEGER NOT NULL DEFAULT 0,
  vault_path TEXT,
  created_at TEXT    NOT NULL DEFAULT NOW(),
  user_id    INTEGER REFERENCES users(id)
);

-- ─── Habits ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS habits (
  id          SERIAL PRIMARY KEY,
  title       TEXT    NOT NULL,
  icon        TEXT    NOT NULL DEFAULT '✅',
  color       TEXT    NOT NULL DEFAULT '#6366f1',
  frequency   TEXT    NOT NULL DEFAULT 'daily',
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT NOW(),
  remind_time TEXT,
  user_id     INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS habit_logs (
  id        SERIAL PRIMARY KEY,
  habit_id  INTEGER NOT NULL REFERENCES habits(id),
  date      TEXT    NOT NULL,
  completed INTEGER NOT NULL DEFAULT 1,
  UNIQUE(habit_id, date)
);

-- ─── Goals / OKR ─────────────────────────────────────────────────────────────

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
  created_at    TEXT NOT NULL DEFAULT NOW(),
  user_id       INTEGER REFERENCES users(id)
);

-- Add forward reference FK for tasks.goal_id → goals.id
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'tasks_goal_id_fkey'
  ) THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES goals(id);
  END IF;
END $$;

-- Add forward reference FK for meetings.goal_id → goals.id
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'meetings_goal_id_fkey'
  ) THEN
    ALTER TABLE meetings ADD CONSTRAINT meetings_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES goals(id);
  END IF;
END $$;

-- ─── Task comments ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_comments (
  id         SERIAL PRIMARY KEY,
  task_id    INTEGER NOT NULL REFERENCES tasks(id),
  text       TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT NOW()
);

-- ─── Journal / daily notes ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS journal (
  id         SERIAL PRIMARY KEY,
  date       TEXT    NOT NULL UNIQUE,
  focus      TEXT    NOT NULL DEFAULT '',
  gratitude  TEXT    NOT NULL DEFAULT '',
  notes      TEXT    NOT NULL DEFAULT '',
  results    TEXT    NOT NULL DEFAULT '',
  mood       INTEGER NOT NULL DEFAULT 3,
  created_at TEXT    NOT NULL DEFAULT NOW(),
  user_id    INTEGER REFERENCES users(id)
);

-- ─── Tags ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tags (
  id      SERIAL PRIMARY KEY,
  name    TEXT    NOT NULL,
  color   TEXT    NOT NULL DEFAULT '#6366f1',
  user_id INTEGER REFERENCES users(id),
  UNIQUE(name, user_id)
);

CREATE TABLE IF NOT EXISTS task_tags (
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  tag_id  INTEGER NOT NULL REFERENCES tags(id),
  PRIMARY KEY (task_id, tag_id)
);

-- ─── Task dependencies ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id       INTEGER NOT NULL REFERENCES tasks(id),
  depends_on_id INTEGER NOT NULL REFERENCES tasks(id),
  PRIMARY KEY (task_id, depends_on_id)
);

-- ─── Task templates ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_templates (
  id          SERIAL PRIMARY KEY,
  title       TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  priority    INTEGER NOT NULL DEFAULT 3,
  project_id  INTEGER REFERENCES projects(id),
  tags        TEXT    NOT NULL DEFAULT '[]',
  created_at  TEXT    NOT NULL DEFAULT NOW(),
  user_id     INTEGER REFERENCES users(id)
);

-- ─── Settings ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS settings (
  key     TEXT    NOT NULL,
  value   TEXT    NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  PRIMARY KEY (key, user_id)
);

-- ─── Notification log ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_log (
  user_id INTEGER NOT NULL,
  type    TEXT    NOT NULL,
  ref_id  TEXT    NOT NULL,
  sent_at TEXT    NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, type, ref_id)
);

-- ─── Verification codes ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS verification_codes (
  id         SERIAL PRIMARY KEY,
  email      TEXT NOT NULL,
  code       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK(type IN ('register','reset','link_tg')),
  expires_at TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT NOW()
);

-- ─── Refresh tokens ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  token      TEXT    NOT NULL UNIQUE,
  expires_at TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT NOW()
);

-- ─── Usage logs ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS usage_logs (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id),
  type       TEXT    NOT NULL,
  model      TEXT    NOT NULL DEFAULT '',
  tokens_in  INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_usd   DOUBLE PRECISION NOT NULL DEFAULT 0,
  detail     TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT NOW()
);

-- ─── Full-text search index on tasks ─────────────────────────────────────────

CREATE INDEX IF NOT EXISTS tasks_search_vector_idx ON tasks USING GIN(search_vector);

CREATE OR REPLACE FUNCTION tasks_search_update() RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('russian', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('russian', coalesce(NEW.description, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_search_vector_trigger ON tasks;
CREATE TRIGGER tasks_search_vector_trigger
  BEFORE INSERT OR UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION tasks_search_update();
