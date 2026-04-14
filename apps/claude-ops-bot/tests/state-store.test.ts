import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'fs-extra';
import { readJson, writeJson, ensureDirs } from '../src/state-store.js';

const tmp = path.join(os.tmpdir(), 'claude-ops-test-' + Date.now());

afterAll(() => fs.remove(tmp));

test('ensureDirs creates state layout', async () => {
  await ensureDirs(tmp);
  expect(await fs.pathExists(path.join(tmp, 'sessions'))).toBe(true);
  expect(await fs.pathExists(path.join(tmp, 'logs'))).toBe(true);
  expect(await fs.pathExists(path.join(tmp, 'backups'))).toBe(true);
});

test('writeJson then readJson returns same data', async () => {
  const p = path.join(tmp, 'x.json');
  await writeJson(p, { a: 1 });
  expect(await readJson(p)).toEqual({ a: 1 });
});

test('readJson returns null when missing', async () => {
  expect(await readJson(path.join(tmp, 'missing.json'))).toBeNull();
});
