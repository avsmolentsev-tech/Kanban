import { Pool, PoolConfig, QueryResult, QueryResultRow } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

let _pool: Pool | null = null;

export async function initPg(databaseUrl: string): Promise<void> {
  const poolConfig: PoolConfig = {
    connectionString: databaseUrl,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };
  _pool = new Pool(poolConfig);
  const client = await _pool.connect();
  client.release();
  console.log('[db] PostgreSQL connected');
}

export async function runSchema(): Promise<void> {
  const pool = getPool();
  const sql = fs.readFileSync(path.resolve(__dirname, 'schema-pg.sql'), 'utf-8');
  await pool.query(sql);
  console.log('[db] schema applied');
}

export function getPool(): Pool {
  if (!_pool) throw new Error('PostgreSQL pool not initialized. Call initPg() first.');
  return _pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string, params?: unknown[]
): Promise<QueryResult<T>> {
  return getPool().query<T>(sql, params);
}

export async function queryAll<T extends QueryResultRow = QueryResultRow>(
  sql: string, params?: unknown[]
): Promise<T[]> {
  const result = await getPool().query<T>(sql, params);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string, params?: unknown[]
): Promise<T | undefined> {
  const result = await getPool().query<T>(sql, params);
  return result.rows[0];
}

export async function execute(sql: string, params?: unknown[]): Promise<number> {
  const result = await getPool().query(sql, params);
  return result.rowCount ?? 0;
}

export async function closePg(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
