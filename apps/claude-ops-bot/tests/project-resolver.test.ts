import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'fs-extra';
import { ProjectResolver } from '../src/project-resolver.js';

const tmp = path.join(os.tmpdir(), 'claude-ops-resolve-' + Date.now());
const reposFile = path.join(tmp, 'repos.json');
const gitRepo = path.join(tmp, 'proj-a');
const folderOnly = path.join(tmp, 'proj-b');

beforeAll(async () => {
  await fs.mkdirp(path.join(gitRepo, '.git'));
  await fs.mkdirp(folderOnly);
});
afterAll(() => fs.remove(tmp));

test('empty whitelist has no active target', async () => {
  await fs.writeJson(reposFile, []);
  const r = new ProjectResolver(reposFile);
  await r.load();
  expect(r.list()).toEqual([]);
});

test('addRepo detects git vs folder type', async () => {
  await fs.writeJson(reposFile, []);
  const r = new ProjectResolver(reposFile);
  await r.load();
  await r.addRepo(gitRepo, 'proj-a');
  await r.addRepo(folderOnly, 'proj-b');
  const list = r.list();
  expect(list.find((t) => t.name === 'proj-a')?.type).toBe('git');
  expect(list.find((t) => t.name === 'proj-b')?.type).toBe('folder');
});

test('addRepo rejects nonexistent path', async () => {
  const r = new ProjectResolver(reposFile);
  await r.load();
  await expect(r.addRepo('/does/not/exist', 'x')).rejects.toThrow(/not exist/);
});

test('get by name returns target', async () => {
  const r = new ProjectResolver(reposFile);
  await r.load();
  expect(r.get('proj-a')?.path).toBe(gitRepo);
});

test('get returns undefined for unknown name', async () => {
  const r = new ProjectResolver(reposFile);
  await r.load();
  expect(r.get('unknown')).toBeUndefined();
});
