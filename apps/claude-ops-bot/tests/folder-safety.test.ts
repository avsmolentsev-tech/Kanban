import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'fs-extra';
import { snapshot, restoreLatest, pruneOldSnapshots } from '../src/folder-safety.js';

const tmp = path.join(os.tmpdir(), 'folder-safety-' + Date.now());
const target = path.join(tmp, 'vault');
const backupsRoot = path.join(tmp, 'backups');

beforeEach(async () => {
  await fs.mkdirp(target);
  await fs.writeFile(path.join(target, 'note.md'), 'original');
});
afterEach(() => fs.remove(tmp));

test('snapshot then restoreLatest restores prior content', async () => {
  const sid = 'session1';
  await snapshot(target, backupsRoot, sid);
  await fs.writeFile(path.join(target, 'note.md'), 'modified');
  await restoreLatest(target, backupsRoot, sid);
  expect(await fs.readFile(path.join(target, 'note.md'), 'utf-8')).toBe('original');
});

test('pruneOldSnapshots keeps last 5', async () => {
  const sid = 'session2';
  for (let i = 0; i < 7; i++) {
    await snapshot(target, backupsRoot, sid);
    await new Promise((r) => setTimeout(r, 10));
  }
  await pruneOldSnapshots(backupsRoot, sid, 5);
  const dirs = await fs.readdir(path.join(backupsRoot, sid));
  expect(dirs.length).toBe(5);
});
