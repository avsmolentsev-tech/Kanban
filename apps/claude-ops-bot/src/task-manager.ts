import type Database from 'better-sqlite3';
import { createTask, updateTask, getTask, getActiveTasks, addEvent, type TaskRow } from './db.js';
import { ClaudeRunner, type ClaudeRunnerOpts } from './claude-runner.js';
import { spawn } from 'node:child_process';

export type TaskState = 'CREATED' | 'PLANNING' | 'PLAN_GATE' | 'RUNNING' | 'VERIFYING' | 'DONE' | 'FAILED' | 'REJECTED';

export const VALID_TRANSITIONS: Record<TaskState, TaskState[]> = {
  CREATED:    ['PLANNING'],
  PLANNING:   ['PLAN_GATE', 'FAILED'],
  PLAN_GATE:  ['RUNNING', 'REJECTED', 'PLANNING'],
  RUNNING:    ['VERIFYING', 'FAILED'],
  VERIFYING:  ['DONE', 'FAILED'],
  DONE:       [],
  FAILED:     ['RUNNING', 'REJECTED'],
  REJECTED:   [],
};

export const TaskStateMachine = {
  canTransition(from: TaskState, to: TaskState): boolean {
    return VALID_TRANSITIONS[from]?.includes(to) ?? false;
  },
};

export interface RunningTask {
  taskId: number;
  runner: ClaudeRunner;
  tmuxSession: string;
}

export interface TaskManagerOpts {
  db: Database.Database;
  maxConcurrent: number;
  claudeBin: string;
}

export class TaskManager {
  private running = new Map<number, RunningTask>();

  constructor(private readonly opts: TaskManagerOpts) {}

  get activeCount(): number {
    return this.running.size;
  }

  canAcceptTask(): boolean {
    return this.running.size < this.opts.maxConcurrent;
  }

  getRunning(taskId: number): RunningTask | undefined {
    return this.running.get(taskId);
  }

  allRunning(): RunningTask[] {
    return [...this.running.values()];
  }

  transition(taskId: number, to: TaskState): TaskRow {
    const task = getTask(this.opts.db, taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    const from = task.state as TaskState;
    if (!TaskStateMachine.canTransition(from, to)) {
      throw new Error(`Invalid transition: ${from} → ${to}`);
    }
    const now = new Date().toISOString();
    const updates: Partial<TaskRow> = { state: to };
    if (to === 'DONE' || to === 'FAILED' || to === 'REJECTED') {
      updates.finished_at = now;
      updates.duration_ms = new Date(now).getTime() - new Date(task.created_at).getTime();
    }
    updateTask(this.opts.db, taskId, updates);
    addEvent(this.opts.db, taskId, 'state_change', { from, to });
    return getTask(this.opts.db, taskId)!;
  }

  registerRunner(taskId: number, runner: ClaudeRunner, tmuxSession: string): void {
    this.running.set(taskId, { taskId, runner, tmuxSession });
  }

  unregisterRunner(taskId: number): void {
    this.running.delete(taskId);
  }

  stopTask(taskId: number): boolean {
    const rt = this.running.get(taskId);
    if (!rt || !rt.runner.isRunning()) return false;
    rt.runner.stop();
    return true;
  }
}

function runGit(cwd: string, args: string[]): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    const p = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    p.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    p.on('close', (code) => resolve({ stdout, code: code ?? -1 }));
  });
}

export async function createWorktree(repoPath: string, taskId: number): Promise<{ worktreePath: string; branch: string }> {
  const branch = `forge/task-${taskId}`;
  const worktreePath = `${repoPath}/../.forge-worktrees/task-${taskId}`;
  const create = await runGit(repoPath, ['worktree', 'add', '-b', branch, worktreePath]);
  if (create.code !== 0) throw new Error(`Failed to create worktree for task ${taskId}`);
  return { worktreePath, branch };
}

export async function removeWorktree(repoPath: string, worktreePath: string, branch: string): Promise<void> {
  await runGit(repoPath, ['worktree', 'remove', '--force', worktreePath]);
  await runGit(repoPath, ['branch', '-D', branch]);
}

export async function getWorktreeDiffStat(worktreePath: string): Promise<{ files: Array<{ path: string; added: number; removed: number }>; totalAdded: number; totalRemoved: number }> {
  const result = await runGit(worktreePath, ['diff', '--numstat', 'HEAD~1..HEAD']);
  const files: Array<{ path: string; added: number; removed: number }> = [];
  let totalAdded = 0, totalRemoved = 0;
  for (const line of result.stdout.trim().split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const added = Number(parts[0]) || 0;
    const removed = Number(parts[1]) || 0;
    files.push({ path: parts[2]!, added, removed });
    totalAdded += added;
    totalRemoved += removed;
  }
  return { files, totalAdded, totalRemoved };
}

export async function getWorktreeDiff(worktreePath: string): Promise<string> {
  const result = await runGit(worktreePath, ['diff', 'HEAD~1..HEAD']);
  return result.stdout;
}
