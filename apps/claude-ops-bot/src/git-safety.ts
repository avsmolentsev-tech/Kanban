import { spawn } from 'node:child_process';

export interface DiffInfo {
  files: string[];
  totalChanges: number;
}

export type DiffClass =
  | { kind: 'small' }
  | { kind: 'large'; reason: string };

const BLACKLIST_PATTERNS = [
  /(^|\/)auth[^/]*$/,
  /(^|\/)user-scope[^/]*$/,
  /(^|\/)db\/schema[^/]*$/,
  /(^|\/)migrations\//,
  /(^|\/)\.env($|\.)/,
  /(^|\/)\.github\/workflows\//,
  /(^|\/)package\.json$/,
  /(^|\/)pnpm-lock\.yaml$/,
];

export function classifyDiff(info: DiffInfo): DiffClass {
  if (info.files.length > 3) return { kind: 'large', reason: `too many files (${info.files.length})` };
  if (info.totalChanges > 200) return { kind: 'large', reason: `too many lines (${info.totalChanges})` };
  for (const f of info.files) {
    for (const pat of BLACKLIST_PATTERNS) {
      if (pat.test(f)) return { kind: 'large', reason: `blacklist: ${f}` };
    }
  }
  return { kind: 'small' };
}

function runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const p = spawn('git', args, { cwd });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => { stdout += d.toString(); });
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('close', (code) => resolve({ stdout, stderr, code: code ?? -1 }));
  });
}

export async function inspectLastCommit(cwd: string): Promise<DiffInfo | null> {
  const head = await runGit(cwd, ['rev-parse', 'HEAD']);
  const prev = await runGit(cwd, ['rev-parse', 'origin/master']);
  if (head.code !== 0 || prev.code !== 0) return null;
  if (head.stdout.trim() === prev.stdout.trim()) return null; // no new commit
  const stat = await runGit(cwd, ['diff', '--numstat', 'origin/master..HEAD']);
  if (stat.code !== 0) return null;
  const files: string[] = [];
  let total = 0;
  for (const line of stat.stdout.trim().split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const added = Number(parts[0]) || 0;
    const removed = Number(parts[1]) || 0;
    files.push(parts[2]!);
    total += added + removed;
  }
  return { files, totalChanges: total };
}

export async function pushMaster(cwd: string): Promise<string> {
  const r = await runGit(cwd, ['push', 'origin', 'master']);
  if (r.code !== 0) throw new Error('git push failed: ' + r.stderr);
  const sha = await runGit(cwd, ['rev-parse', '--short', 'HEAD']);
  return sha.stdout.trim();
}

export async function parkOnBranch(cwd: string, slug: string): Promise<string> {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-T:]/g, '').slice(0, 12);
  const safeSlug = slug.slice(0, 40).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'change';
  const branch = `claude/${stamp}-${safeSlug}`;
  const ops = [
    ['branch', branch],
    ['reset', '--hard', 'origin/master'],
    ['push', 'origin', branch],
  ];
  for (const args of ops) {
    const r = await runGit(cwd, args);
    if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  }
  return branch;
}

export async function mergeBranch(cwd: string, branch: string): Promise<void> {
  const ops = [
    ['checkout', 'master'],
    ['fetch', 'origin', branch],
    ['merge', '--ff-only', `origin/${branch}`],
    ['push', 'origin', 'master'],
  ];
  for (const args of ops) {
    const r = await runGit(cwd, args);
    if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  }
}

export async function revertHead(cwd: string): Promise<string> {
  const r = await runGit(cwd, ['revert', '--no-edit', 'HEAD']);
  if (r.code !== 0) throw new Error('git revert failed: ' + r.stderr);
  const push = await runGit(cwd, ['push', 'origin', 'master']);
  if (push.code !== 0) throw new Error('git push failed: ' + push.stderr);
  const sha = await runGit(cwd, ['rev-parse', '--short', 'HEAD']);
  return sha.stdout.trim();
}
