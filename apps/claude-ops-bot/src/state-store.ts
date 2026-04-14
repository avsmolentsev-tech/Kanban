import * as path from 'node:path';
import * as fs from 'fs-extra';

export async function ensureDirs(stateDir: string): Promise<void> {
  await fs.mkdirp(path.join(stateDir, 'sessions'));
  await fs.mkdirp(path.join(stateDir, 'logs'));
  await fs.mkdirp(path.join(stateDir, 'backups'));
  await fs.chmod(stateDir, 0o700).catch(() => {});
}

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err: any) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeJson(file: string, data: unknown): Promise<void> {
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}
