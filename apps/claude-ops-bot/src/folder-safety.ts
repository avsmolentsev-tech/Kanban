// TODO: switch to cp -al on Linux for space savings (hard-link snapshots)
import * as path from 'node:path';
import fs from 'fs-extra';

export async function snapshot(targetDir: string, backupsRoot: string, sessionId: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(backupsRoot, sessionId, stamp);
  await fs.mkdirp(dest);
  await fs.copy(targetDir, dest, { dereference: false, preserveTimestamps: true });
  return dest;
}

export async function listSnapshots(backupsRoot: string, sessionId: string): Promise<string[]> {
  const dir = path.join(backupsRoot, sessionId);
  if (!(await fs.pathExists(dir))) return [];
  const entries = await fs.readdir(dir);
  return entries.sort();
}

export async function restoreLatest(targetDir: string, backupsRoot: string, sessionId: string): Promise<void> {
  const snaps = await listSnapshots(backupsRoot, sessionId);
  if (snaps.length === 0) throw new Error('No snapshots to restore');
  const latest = snaps[snaps.length - 1]!;
  const src = path.join(backupsRoot, sessionId, latest);
  await fs.emptyDir(targetDir);
  await fs.copy(src, targetDir, { dereference: false, preserveTimestamps: true });
}

export async function pruneOldSnapshots(backupsRoot: string, sessionId: string, keep = 5): Promise<void> {
  const snaps = await listSnapshots(backupsRoot, sessionId);
  const remove = snaps.slice(0, Math.max(0, snaps.length - keep));
  for (const s of remove) {
    await fs.remove(path.join(backupsRoot, sessionId, s));
  }
}
