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
}

export function closeDb(): void {
  _db?.close();
  _db = null;
}
