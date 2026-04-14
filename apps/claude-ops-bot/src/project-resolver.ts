import * as path from 'node:path';
import fs from 'fs-extra';
import { readJson, writeJson } from './state-store.js';

export type TargetType = 'git' | 'folder';

export interface Target {
  name: string;
  path: string;
  type: TargetType;
}

export class ProjectResolver {
  private targets: Target[] = [];

  constructor(private readonly reposFile: string) {}

  async load(): Promise<void> {
    this.targets = (await readJson<Target[]>(this.reposFile)) ?? [];
  }

  list(): Target[] {
    return [...this.targets];
  }

  get(name: string): Target | undefined {
    return this.targets.find((t) => t.name === name);
  }

  async addRepo(absPath: string, name: string): Promise<Target> {
    if (!path.isAbsolute(absPath)) throw new Error('Path must be absolute');
    if (!(await fs.pathExists(absPath))) throw new Error('Path does not exist');
    if (this.targets.find((t) => t.name === name)) throw new Error(`Name '${name}' already exists`);
    const type: TargetType = (await fs.pathExists(path.join(absPath, '.git'))) ? 'git' : 'folder';
    const target: Target = { name, path: absPath, type };
    this.targets.push(target);
    await writeJson(this.reposFile, this.targets);
    return target;
  }
}
