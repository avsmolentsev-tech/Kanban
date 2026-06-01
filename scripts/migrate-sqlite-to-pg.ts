/**
 * One-time migration: SQLite → PostgreSQL
 * Run from project root: npx tsx scripts/migrate-sqlite-to-pg.ts
 */
import Database from 'better-sqlite3';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), 'packages/api/.env') });
// Also try root .env
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const SQLITE_PATH = process.env['DATABASE_PATH'] || path.resolve(process.cwd(), 'data/pis.db');
const PG_URL = process.env['DATABASE_URL'];

if (!PG_URL) {
  console.error('ERROR: DATABASE_URL not set in .env');
  process.exit(1);
}

if (!fs.existsSync(SQLITE_PATH)) {
  console.error('ERROR: SQLite database not found at', SQLITE_PATH);
  process.exit(1);
}

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
  console.log('=== SQLite → PostgreSQL Migration ===\n');
  console.log('SQLite:', SQLITE_PATH);
  console.log('PostgreSQL:', PG_URL!.replace(/:[^@]+@/, ':***@'));
  console.log('');

  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  const pg = new Pool({ connectionString: PG_URL });

  // Test PG connection
  const client = await pg.connect();
  client.release();
  console.log('PostgreSQL connected ✓\n');

  // Apply schema
  const schemaPath = path.resolve(__dirname, '../packages/api/src/db/schema-pg.sql');
  if (fs.existsSync(schemaPath)) {
    console.log('Applying schema...');
    const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
    await pg.query(schemaSql);
    console.log('Schema applied ✓\n');
  } else {
    console.error('ERROR: schema-pg.sql not found at', schemaPath);
    process.exit(1);
  }

  let totalRows = 0;
  let totalErrors = 0;

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

    // Filter out columns that don't exist in PG (like search_vector which is auto-generated)
    const pgColumns = await pg.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
      [table]
    );
    const pgColSet = new Set(pgColumns.rows.map((r: any) => r.column_name));
    const columns = Object.keys(rows[0]!).filter(c => pgColSet.has(c));

    if (columns.length === 0) {
      console.log(`  SKIP ${table} (no matching columns)`);
      continue;
    }

    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const colList = columns.map(c => `"${c}"`).join(', ');
    const insertSql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;

    let inserted = 0;
    let errors = 0;

    // Use a transaction for each table for performance
    const txClient = await pg.connect();
    try {
      await txClient.query('BEGIN');
      for (const row of rows) {
        const values = columns.map(c => {
          const v = row[c];
          if (v === undefined) return null;
          return v;
        });
        try {
          const result = await txClient.query(insertSql, values);
          if (result.rowCount && result.rowCount > 0) inserted++;
        } catch (err) {
          errors++;
          if (errors <= 3) {
            console.error(`    ERROR in ${table}: ${(err as Error).message.slice(0, 100)}`);
          }
        }
      }
      await txClient.query('COMMIT');
    } catch (err) {
      await txClient.query('ROLLBACK');
      console.error(`  ROLLBACK ${table}: ${(err as Error).message}`);
      errors = rows.length;
    } finally {
      txClient.release();
    }

    console.log(`  ${table}: ${inserted}/${rows.length} rows${errors > 0 ? ` (${errors} errors)` : ''}`);
    totalRows += inserted;
    totalErrors += errors;

    // Reset serial sequence for tables with 'id' column
    if (columns.includes('id')) {
      try {
        await pg.query(
          `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 0) + 1, false)`
        );
      } catch {
        // Some tables might not have a serial sequence (junction tables)
      }
    }
  }

  // Rebuild search vectors for tasks
  console.log('\nRebuilding search vectors...');
  await pg.query(`
    UPDATE tasks SET search_vector =
      setweight(to_tsvector('russian', COALESCE(title, '')), 'A') ||
      setweight(to_tsvector('russian', COALESCE(description, '')), 'B')
  `);
  console.log('Search vectors rebuilt ✓');

  // Verification
  console.log('\n=== Verification ===');
  let allMatch = true;
  for (const table of TABLES_ORDERED) {
    const sqliteExists = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
    if (!sqliteExists) continue;
    const sqliteCount = (sqlite.prepare(`SELECT COUNT(*) as c FROM "${table}"`).get() as { c: number }).c;
    if (sqliteCount === 0) continue;
    const pgResult = await pg.query(`SELECT COUNT(*) as c FROM "${table}"`);
    const pgCount = parseInt(pgResult.rows[0].c);
    const match = sqliteCount === pgCount ? '✓' : '✗ MISMATCH';
    if (sqliteCount !== pgCount) allMatch = false;
    console.log(`  ${table}: SQLite=${sqliteCount} PG=${pgCount} ${match}`);
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total rows migrated: ${totalRows}`);
  console.log(`Total errors: ${totalErrors}`);
  console.log(`All counts match: ${allMatch ? '✓ YES' : '✗ NO — check above'}`);

  sqlite.close();
  await pg.end();

  if (!allMatch || totalErrors > 0) {
    console.log('\n⚠️  Migration completed with issues — review above');
    process.exit(1);
  } else {
    console.log('\n✅ Migration completed successfully!');
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
