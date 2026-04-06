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
