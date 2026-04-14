# Claude Ops Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private Telegram bot that routes Slava's messages into Claude Code on the production server so Claude can autonomously modify whitelisted repos or the Obsidian vault and push changes.

**Architecture:** Separate Node/Telegraf process under PM2 (`claude-ops-bot`). Single-tg-id auth. Session-based conversation; each round spawns `claude -p bypassPermissions` with the active target as cwd and pipes stdout back to TG. Git safety layer classifies diffs and auto-merges small changes or parks large changes on a branch awaiting `/merge`. Folder targets (vault) use hard-linked snapshots instead of git.

**Tech Stack:** TypeScript, Telegraf v4, Node `child_process.spawn`, `fs-extra` for backups, existing `whisper-local.service` from `packages/api`, PM2. Reuses OAuth-authenticated `claude` CLI already on the server.

**Spec:** `docs/superpowers/specs/2026-04-14-claude-ops-bot-design.md`

---

## File Structure

```
apps/claude-ops-bot/
  package.json                     — new workspace pkg @pis/claude-ops-bot
  tsconfig.json
  .env.example
  src/
    index.ts                       — entrypoint, boots bot, handles shutdown
    config.ts                      — env parsing, state dir resolution
    bot.ts                         — Telegraf setup, handler registration
    auth.ts                        — single-tg-id middleware
    session.ts                     — SessionManager class
    project-resolver.ts            — whitelist load/save, resolve target
    claude-runner.ts               — spawn Claude, pipe stdio
    git-safety.ts                  — classify, push, merge, revert
    folder-safety.ts               — snapshot + restore for folder targets
    whisper.ts                     — wrapper over packages/api whisper service
    tg-format.ts                   — 3500-char chunker, markdown escape
    state-store.ts                 — JSON persistence for sessions + repos.json
  tests/
    auth.test.ts
    session.test.ts
    project-resolver.test.ts
    git-safety.test.ts
    folder-safety.test.ts
    tg-format.test.ts
```

Server state (not in repo):
```
~/.claude-ops/
  repos.json
  sessions/<tg_id>.json
  logs/<session_id>.log
  backups/<session_id>/<ts>/…
```

---

## Phase 1 — Scaffold the package

### Task 1: Create package skeleton

**Files:**
- Create: `apps/claude-ops-bot/package.json`
- Create: `apps/claude-ops-bot/tsconfig.json`
- Create: `apps/claude-ops-bot/.env.example`
- Create: `apps/claude-ops-bot/src/index.ts`
- Modify: `pnpm-workspace.yaml` (add `apps/claude-ops-bot`)

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@pis/claude-ops-bot",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/index.ts",
    "dev": "tsx watch src/index.ts",
    "test": "jest"
  },
  "dependencies": {
    "telegraf": "^4.16.3",
    "dotenv": "^16.4.5",
    "fs-extra": "^11.2.0",
    "@pis/api": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "tsx": "^4.7.0",
    "@types/node": "^20.11.0",
    "@types/fs-extra": "^11.0.4",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.0",
    "@types/jest": "^29.5.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "module": "ESNext",
    "moduleResolution": "Bundler"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create .env.example**

```
TELEGRAM_OPS_BOT_TOKEN=
ALLOWED_TG_ID=849367993
CLAUDE_OPS_STATE_DIR=/root/.claude-ops
SESSION_TIMEOUT_MINUTES=30
DEFAULT_MODEL=sonnet
CLAUDE_BIN=/usr/local/bin/claude
```

- [ ] **Step 4: Create src/index.ts placeholder**

```typescript
import 'dotenv/config';
import { startBot } from './bot.js';

startBot().catch((err) => {
  console.error('[claude-ops-bot] fatal:', err);
  process.exit(1);
});
```

- [ ] **Step 5: Add to pnpm-workspace.yaml**

Append under `packages:`:
```yaml
  - 'apps/claude-ops-bot'
```

- [ ] **Step 6: Install**

Run: `pnpm install`
Expected: new workspace package picked up, no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/claude-ops-bot pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "chore(claude-ops-bot): scaffold package"
```

---

### Task 2: Config module

**Files:**
- Create: `apps/claude-ops-bot/src/config.ts`
- Create: `apps/claude-ops-bot/tests/config.test.ts`

- [ ] **Step 1: Write failing test**

`tests/config.test.ts`:
```typescript
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  const OLD = process.env;
  afterEach(() => { process.env = OLD; });

  test('parses happy path', () => {
    process.env = { ...OLD, TELEGRAM_OPS_BOT_TOKEN: 't', ALLOWED_TG_ID: '42' };
    const c = loadConfig();
    expect(c.telegramToken).toBe('t');
    expect(c.allowedTgId).toBe(42);
    expect(c.sessionTimeoutMs).toBe(30 * 60_000);
    expect(c.defaultModel).toBe('sonnet');
  });

  test('throws when token missing', () => {
    process.env = { ...OLD, ALLOWED_TG_ID: '42' };
    delete process.env.TELEGRAM_OPS_BOT_TOKEN;
    expect(() => loadConfig()).toThrow(/TELEGRAM_OPS_BOT_TOKEN/);
  });

  test('throws when allowed tg id missing or non-numeric', () => {
    process.env = { ...OLD, TELEGRAM_OPS_BOT_TOKEN: 't', ALLOWED_TG_ID: 'abc' };
    expect(() => loadConfig()).toThrow(/ALLOWED_TG_ID/);
  });
});
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm --filter @pis/claude-ops-bot test -t loadConfig`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement config.ts**

```typescript
import * as path from 'node:path';
import * as os from 'node:os';

export interface OpsConfig {
  telegramToken: string;
  allowedTgId: number;
  stateDir: string;
  sessionTimeoutMs: number;
  defaultModel: 'sonnet' | 'opus';
  claudeBin: string;
}

export function loadConfig(): OpsConfig {
  const token = process.env.TELEGRAM_OPS_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_OPS_BOT_TOKEN is required');

  const idStr = process.env.ALLOWED_TG_ID ?? '';
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) throw new Error('ALLOWED_TG_ID must be a positive integer');

  const rawStateDir = process.env.CLAUDE_OPS_STATE_DIR ?? path.join(os.homedir(), '.claude-ops');
  const stateDir = rawStateDir.startsWith('~')
    ? path.join(os.homedir(), rawStateDir.slice(1))
    : rawStateDir;

  const timeoutMin = Number(process.env.SESSION_TIMEOUT_MINUTES ?? 30);
  const model = (process.env.DEFAULT_MODEL ?? 'sonnet') as 'sonnet' | 'opus';

  return {
    telegramToken: token,
    allowedTgId: id,
    stateDir,
    sessionTimeoutMs: timeoutMin * 60_000,
    defaultModel: model,
    claudeBin: process.env.CLAUDE_BIN ?? 'claude',
  };
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `pnpm --filter @pis/claude-ops-bot test -t loadConfig`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/claude-ops-bot/src/config.ts apps/claude-ops-bot/tests/config.test.ts
git commit -m "feat(claude-ops-bot): config loader with env validation"
```

---

## Phase 2 — Auth + state store + project resolver

### Task 3: Auth middleware

**Files:**
- Create: `apps/claude-ops-bot/src/auth.ts`
- Create: `apps/claude-ops-bot/tests/auth.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { makeAuthMiddleware } from '../src/auth.js';

function fakeCtx(fromId: number | undefined) {
  const replies: string[] = [];
  return {
    from: fromId == null ? undefined : { id: fromId },
    reply: (t: string) => { replies.push(t); return Promise.resolve(); },
    _replies: replies,
  };
}

test('passes when id matches', async () => {
  const mw = makeAuthMiddleware(42);
  const ctx: any = fakeCtx(42);
  let nextCalled = false;
  await mw(ctx, async () => { nextCalled = true; });
  expect(nextCalled).toBe(true);
  expect(ctx._replies).toHaveLength(0);
});

test('blocks when id differs', async () => {
  const mw = makeAuthMiddleware(42);
  const ctx: any = fakeCtx(100);
  let nextCalled = false;
  await mw(ctx, async () => { nextCalled = true; });
  expect(nextCalled).toBe(false);
  expect(ctx._replies[0]).toMatch(/not authorized/i);
});

test('blocks when id missing', async () => {
  const mw = makeAuthMiddleware(42);
  const ctx: any = fakeCtx(undefined);
  let nextCalled = false;
  await mw(ctx, async () => { nextCalled = true; });
  expect(nextCalled).toBe(false);
});
```

- [ ] **Step 2: Implement**

```typescript
import type { Context, MiddlewareFn } from 'telegraf';

export function makeAuthMiddleware(allowedTgId: number): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const id = ctx.from?.id;
    if (id !== allowedTgId) {
      if (id != null) await ctx.reply('not authorized');
      return;
    }
    return next();
  };
}
```

- [ ] **Step 3: Run tests — pass**

Run: `pnpm --filter @pis/claude-ops-bot test auth`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/claude-ops-bot/src/auth.ts apps/claude-ops-bot/tests/auth.test.ts
git commit -m "feat(claude-ops-bot): tg_id whitelist middleware"
```

---

### Task 4: State store (JSON on disk)

**Files:**
- Create: `apps/claude-ops-bot/src/state-store.ts`
- Create: `apps/claude-ops-bot/tests/state-store.test.ts`

- [ ] **Step 1: Failing tests**

```typescript
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
```

- [ ] **Step 2: Implement**

```typescript
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
```

- [ ] **Step 3: Run tests — pass**

- [ ] **Step 4: Commit**

```bash
git add apps/claude-ops-bot/src/state-store.ts apps/claude-ops-bot/tests/state-store.test.ts
git commit -m "feat(claude-ops-bot): atomic JSON state store"
```

---

### Task 5: ProjectResolver whitelist

**Files:**
- Create: `apps/claude-ops-bot/src/project-resolver.ts`
- Create: `apps/claude-ops-bot/tests/project-resolver.test.ts`

- [ ] **Step 1: Failing tests**

```typescript
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
  await fs.writeJson(reposFile, []);
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
```

- [ ] **Step 2: Implement**

```typescript
import * as path from 'node:path';
import * as fs from 'fs-extra';
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
```

- [ ] **Step 3: Run tests — pass**

- [ ] **Step 4: Commit**

```bash
git add apps/claude-ops-bot/src/project-resolver.ts apps/claude-ops-bot/tests/project-resolver.test.ts
git commit -m "feat(claude-ops-bot): project whitelist loader"
```

---

## Phase 3 — SessionManager

### Task 6: Session data model + in-memory manager

**Files:**
- Create: `apps/claude-ops-bot/src/session.ts`
- Create: `apps/claude-ops-bot/tests/session.test.ts`

- [ ] **Step 1: Failing tests**

```typescript
import { SessionManager } from '../src/session.js';

jest.useFakeTimers();

test('get creates new session with default model', () => {
  const mgr = new SessionManager({ timeoutMs: 1000, defaultModel: 'sonnet' });
  const s = mgr.get(42);
  expect(s.tgId).toBe(42);
  expect(s.model).toBe('sonnet');
  expect(s.activeTarget).toBeUndefined();
});

test('get returns same session on second call', () => {
  const mgr = new SessionManager({ timeoutMs: 1000, defaultModel: 'sonnet' });
  const a = mgr.get(42);
  a.model = 'opus';
  const b = mgr.get(42);
  expect(b.model).toBe('opus');
});

test('inactivity timer closes session', () => {
  const mgr = new SessionManager({ timeoutMs: 1000, defaultModel: 'sonnet' });
  mgr.get(42);
  mgr.touch(42);
  jest.advanceTimersByTime(1500);
  expect(mgr.has(42)).toBe(false);
});

test('touch resets the timer', () => {
  const mgr = new SessionManager({ timeoutMs: 1000, defaultModel: 'sonnet' });
  mgr.get(42);
  mgr.touch(42);
  jest.advanceTimersByTime(500);
  mgr.touch(42);
  jest.advanceTimersByTime(700);
  expect(mgr.has(42)).toBe(true); // because of touch
});

test('end removes session', () => {
  const mgr = new SessionManager({ timeoutMs: 1000, defaultModel: 'sonnet' });
  mgr.get(42);
  mgr.end(42);
  expect(mgr.has(42)).toBe(false);
});
```

- [ ] **Step 2: Implement**

```typescript
import type { Target } from './project-resolver.js';

export interface Session {
  tgId: number;
  activeTarget?: Target;
  model: 'sonnet' | 'opus';
  lastActivityTs: number;
  // Non-persisted runtime handles attached later by ClaudeRunner
  claudeProcess?: unknown;
  pendingUserAnswer: boolean;
}

export interface SessionManagerOpts {
  timeoutMs: number;
  defaultModel: 'sonnet' | 'opus';
}

export class SessionManager {
  private sessions = new Map<number, Session>();
  private timers = new Map<number, NodeJS.Timeout>();

  constructor(private readonly opts: SessionManagerOpts) {}

  get(tgId: number): Session {
    let s = this.sessions.get(tgId);
    if (!s) {
      s = {
        tgId,
        model: this.opts.defaultModel,
        lastActivityTs: Date.now(),
        pendingUserAnswer: false,
      };
      this.sessions.set(tgId, s);
    }
    return s;
  }

  has(tgId: number): boolean { return this.sessions.has(tgId); }

  touch(tgId: number): void {
    const s = this.sessions.get(tgId);
    if (!s) return;
    s.lastActivityTs = Date.now();
    const prev = this.timers.get(tgId);
    if (prev) clearTimeout(prev);
    this.timers.set(tgId, setTimeout(() => this.end(tgId), this.opts.timeoutMs));
  }

  end(tgId: number): void {
    const prev = this.timers.get(tgId);
    if (prev) clearTimeout(prev);
    this.timers.delete(tgId);
    this.sessions.delete(tgId);
  }

  all(): Session[] { return [...this.sessions.values()]; }
}
```

- [ ] **Step 3: Run tests — pass**

- [ ] **Step 4: Commit**

```bash
git add apps/claude-ops-bot/src/session.ts apps/claude-ops-bot/tests/session.test.ts
git commit -m "feat(claude-ops-bot): in-memory session manager with inactivity timer"
```

---

## Phase 4 — TG chunker + basic bot wiring

### Task 7: Telegram message chunker

**Files:**
- Create: `apps/claude-ops-bot/src/tg-format.ts`
- Create: `apps/claude-ops-bot/tests/tg-format.test.ts`

- [ ] **Step 1: Failing tests**

```typescript
import { chunkForTelegram } from '../src/tg-format.js';

test('short text yields one chunk', () => {
  expect(chunkForTelegram('hello')).toEqual(['hello']);
});

test('long text split on newline boundary', () => {
  const long = 'a'.repeat(2000) + '\n' + 'b'.repeat(2000);
  const chunks = chunkForTelegram(long, 3500);
  expect(chunks).toHaveLength(1);
  expect(chunks[0]).toBe(long);
});

test('very long text splits into 3500-char chunks', () => {
  const long = 'a'.repeat(10_000);
  const chunks = chunkForTelegram(long, 3500);
  expect(chunks.length).toBeGreaterThanOrEqual(3);
  chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(3500));
  expect(chunks.join('')).toBe(long);
});

test('splits prefer newline within 200 chars of limit', () => {
  const line = 'a'.repeat(3000);
  const text = `${line}\n${line}\n${line}`;
  const chunks = chunkForTelegram(text, 3500);
  chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(3500));
});
```

- [ ] **Step 2: Implement**

```typescript
export function chunkForTelegram(text: string, limit = 3500): string[] {
  if (text.length <= limit) return [text];
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + limit, text.length);
    if (end < text.length) {
      const search = text.lastIndexOf('\n', end);
      if (search > i && search > end - 200) end = search + 1;
    }
    out.push(text.slice(i, end));
    i = end;
  }
  return out;
}
```

- [ ] **Step 3: Run tests — pass**

- [ ] **Step 4: Commit**

```bash
git add apps/claude-ops-bot/src/tg-format.ts apps/claude-ops-bot/tests/tg-format.test.ts
git commit -m "feat(claude-ops-bot): TG message chunker"
```

---

### Task 8: Bot skeleton with auth + /start + /repos + /use + /add-repo

**Files:**
- Create: `apps/claude-ops-bot/src/bot.ts`

- [ ] **Step 1: Implement (no test — manual smoke after deploy)**

```typescript
import { Telegraf } from 'telegraf';
import * as path from 'node:path';
import { loadConfig } from './config.js';
import { makeAuthMiddleware } from './auth.js';
import { SessionManager } from './session.js';
import { ProjectResolver } from './project-resolver.js';
import { ensureDirs } from './state-store.js';

export async function startBot(): Promise<void> {
  const cfg = loadConfig();
  await ensureDirs(cfg.stateDir);

  const resolver = new ProjectResolver(path.join(cfg.stateDir, 'repos.json'));
  await resolver.load();

  const sessions = new SessionManager({ timeoutMs: cfg.sessionTimeoutMs, defaultModel: cfg.defaultModel });

  const bot = new Telegraf(cfg.telegramToken, { handlerTimeout: Infinity });
  bot.use(makeAuthMiddleware(cfg.allowedTgId));

  bot.command('start', (ctx) => ctx.reply('Claude Ops bot готов. /repos — список, /add-repo <абсолютный путь> — добавить.'));

  bot.command('repos', (ctx) => {
    const s = sessions.get(ctx.from!.id);
    const list = resolver.list();
    if (list.length === 0) return ctx.reply('Whitelist пуст. /add-repo <path>');
    const lines = list.map((t) => {
      const mark = t.name === s.activeTarget?.name ? '● ' : '  ';
      return `${mark}${t.name} (${t.type}) — ${t.path}`;
    });
    return ctx.reply(lines.join('\n'));
  });

  bot.command('use', async (ctx) => {
    const name = ctx.message.text.replace(/^\/use\s*/, '').trim();
    const target = resolver.get(name);
    if (!target) return ctx.reply(`Нет '${name}'. /repos для списка.`);
    const s = sessions.get(ctx.from!.id);
    s.activeTarget = target;
    sessions.touch(ctx.from!.id);
    return ctx.reply(`Активный: ${target.name} (${target.type}) — ${target.path}`);
  });

  bot.command('add_repo', async (ctx) => {
    const arg = ctx.message.text.replace(/^\/add_repo\s*/, '').trim();
    const parts = arg.split(/\s+/).filter(Boolean);
    const p = parts[0], name = parts[1] ?? path.basename(parts[0] ?? '');
    if (!p) return ctx.reply('Формат: /add_repo <absolute_path> [name]');
    try {
      const t = await resolver.addRepo(p, name);
      return ctx.reply(`✅ ${t.name} (${t.type}) добавлен`);
    } catch (err) {
      return ctx.reply(`❌ ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  bot.command('end', (ctx) => {
    sessions.end(ctx.from!.id);
    return ctx.reply('Сессия закрыта.');
  });

  bot.catch((err) => console.error('[claude-ops-bot] handler error:', err));

  await bot.launch();
  console.log('[claude-ops-bot] started');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/claude-ops-bot/src/bot.ts
git commit -m "feat(claude-ops-bot): bot skeleton with /start /repos /use /add_repo /end"
```

---

## Phase 5 — Claude runner (the core)

### Task 9: ClaudeRunner — spawn + stream

**Files:**
- Create: `apps/claude-ops-bot/src/claude-runner.ts`
- Create: `apps/claude-ops-bot/tests/claude-runner.test.ts`

- [ ] **Step 1: Failing tests**

```typescript
import { ClaudeRunner } from '../src/claude-runner.js';

test('runs simple command and captures stdout', async () => {
  const chunks: string[] = [];
  const runner = new ClaudeRunner({ bin: 'node', args: ['-e', 'console.log("hi"); console.log("bye")'], cwd: process.cwd() });
  await runner.run('', (c) => chunks.push(c));
  const all = chunks.join('');
  expect(all).toContain('hi');
  expect(all).toContain('bye');
});

test('stdin input reaches the process', async () => {
  const chunks: string[] = [];
  const runner = new ClaudeRunner({ bin: 'node', args: ['-e', 'process.stdin.on("data", (d) => { console.log("got:" + d.toString().trim()); process.exit(0); })'], cwd: process.cwd() });
  await runner.run('hello', (c) => chunks.push(c));
  expect(chunks.join('')).toContain('got:hello');
});

test('stop kills the process', async () => {
  const runner = new ClaudeRunner({ bin: 'node', args: ['-e', 'setTimeout(()=>{}, 60000)'], cwd: process.cwd() });
  const p = runner.run('', () => {});
  setTimeout(() => runner.stop(), 100);
  await expect(p).resolves.toBeDefined();
});
```

- [ ] **Step 2: Implement**

```typescript
import { spawn, ChildProcess } from 'node:child_process';

export interface ClaudeRunnerOpts {
  bin: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

export interface RunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export class ClaudeRunner {
  private proc: ChildProcess | null = null;

  constructor(private readonly opts: ClaudeRunnerOpts) {}

  run(stdinInput: string, onOutput: (chunk: string) => void): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.opts.bin, this.opts.args, {
        cwd: this.opts.cwd,
        env: { ...process.env, ...this.opts.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.proc = proc;

      proc.stdout.on('data', (d) => onOutput(d.toString()));
      proc.stderr.on('data', (d) => onOutput(d.toString()));

      proc.on('error', reject);
      proc.on('close', (code, signal) => {
        this.proc = null;
        resolve({ exitCode: code, signal });
      });

      if (stdinInput) proc.stdin.write(stdinInput + '\n');
      proc.stdin.end();
    });
  }

  stop(): void {
    if (!this.proc) return;
    this.proc.kill('SIGINT');
    setTimeout(() => { try { this.proc?.kill('SIGKILL'); } catch {} }, 5000);
  }

  isRunning(): boolean { return this.proc != null && !this.proc.killed; }
}
```

- [ ] **Step 3: Run tests — pass**

- [ ] **Step 4: Commit**

```bash
git add apps/claude-ops-bot/src/claude-runner.ts apps/claude-ops-bot/tests/claude-runner.test.ts
git commit -m "feat(claude-ops-bot): ClaudeRunner — spawn, stream stdout, stop"
```

---

### Task 10: Wire text handler — send messages to Claude, stream replies

**Files:**
- Modify: `apps/claude-ops-bot/src/bot.ts`

- [ ] **Step 1: Add handler**

After `bot.command('end', ...)` in bot.ts, add:

```typescript
const MODEL_FLAG = (m: 'sonnet' | 'opus') => m === 'opus' ? 'claude-opus-4-6' : 'claude-sonnet-4-6';

bot.on('text', async (ctx) => {
  const tgId = ctx.from!.id;
  const text = ctx.message.text;
  if (text.startsWith('/')) return; // commands handled above

  const s = sessions.get(tgId);
  sessions.touch(tgId);

  if (!s.activeTarget) {
    const list = resolver.list();
    if (list.length === 1) {
      s.activeTarget = list[0];
      await ctx.reply(`Активный: ${list[0].name} (единственный в whitelist)`);
    } else if (list.length === 0) {
      return ctx.reply('Whitelist пуст. /add-repo <path>');
    } else {
      return ctx.reply('Какой проект? ' + list.map((t) => `/use ${t.name}`).join(' или '));
    }
  }

  await ctx.reply(`🚀 ${s.activeTarget.name} (${s.model}) старт`);

  const runner = new ClaudeRunner({
    bin: cfg.claudeBin,
    args: ['-p', '--permission-mode', 'bypassPermissions', '--model', MODEL_FLAG(s.model)],
    cwd: s.activeTarget.path,
  });
  s.claudeProcess = runner;

  let buf = '';
  const flush = async (): Promise<void> => {
    if (!buf) return;
    for (const chunk of chunkForTelegram(buf)) {
      await ctx.reply(chunk).catch(() => {});
    }
    buf = '';
  };
  const flushTimer = setInterval(flush, 2000);

  try {
    const res = await runner.run(text, (c) => { buf += c; });
    clearInterval(flushTimer);
    await flush();
    await ctx.reply(res.exitCode === 0 ? `✅ раунд завершён` : `⚠️ exit ${res.exitCode}`);
  } catch (err) {
    clearInterval(flushTimer);
    await ctx.reply(`❌ ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    s.claudeProcess = undefined;
    sessions.touch(tgId);
  }
});
```

Also add imports at top of bot.ts:
```typescript
import { ClaudeRunner } from './claude-runner.js';
import { chunkForTelegram } from './tg-format.js';
```

- [ ] **Step 2: Commit**

```bash
git add apps/claude-ops-bot/src/bot.ts
git commit -m "feat(claude-ops-bot): text handler routes to Claude and streams back"
```

---

### Task 11: /stop, /status, /opus commands

**Files:**
- Modify: `apps/claude-ops-bot/src/bot.ts`

- [ ] **Step 1: Add commands (before `bot.on('text')`)**

```typescript
bot.command('stop', (ctx) => {
  const s = sessions.get(ctx.from!.id);
  const runner = s.claudeProcess as ClaudeRunner | undefined;
  if (!runner || !runner.isRunning()) return ctx.reply('Сейчас ничего не выполняется.');
  runner.stop();
  return ctx.reply('⏹ отправлен SIGINT');
});

bot.command('status', (ctx) => {
  const s = sessions.get(ctx.from!.id);
  if (!s.activeTarget) return ctx.reply('Сессия без активного проекта.');
  const runner = s.claudeProcess as ClaudeRunner | undefined;
  const running = runner?.isRunning() ? 'работает' : 'idle';
  const age = Math.round((Date.now() - s.lastActivityTs) / 1000);
  return ctx.reply(`Проект: ${s.activeTarget.name}\nМодель: ${s.model}\nСтатус: ${running}\nИнактив: ${age}с`);
});

bot.command('opus', (ctx) => {
  const s = sessions.get(ctx.from!.id);
  s.model = 'opus';
  return ctx.reply('Следующий раунд: Opus');
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/claude-ops-bot/src/bot.ts
git commit -m "feat(claude-ops-bot): /stop /status /opus commands"
```

---

## Phase 6 — Voice + files input

### Task 12: Voice handler via shared Whisper

**Files:**
- Create: `apps/claude-ops-bot/src/whisper.ts`
- Modify: `apps/claude-ops-bot/src/bot.ts`

- [ ] **Step 1: Create whisper.ts wrapper**

```typescript
import { transcribeLocal, isLocalWhisperAvailable } from '@pis/api/dist/services/whisper-local.service.js';

export async function transcribe(buffer: Buffer, filename: string): Promise<string> {
  if (!isLocalWhisperAvailable()) throw new Error('Whisper not available on this host');
  return transcribeLocal(buffer, filename);
}
```

Note: if the import path from `@pis/api` doesn't resolve, copy the file into `src/whisper-local.service.ts` during implementation rather than fighting the workspace path. Keep a TODO comment to refactor later.

- [ ] **Step 2: Add handler in bot.ts**

After the text handler, add:

```typescript
import { message } from 'telegraf/filters';
import { transcribe } from './whisper.js';

async function dispatchText(ctx: any, text: string): Promise<void> {
  // Re-enter the text flow with a synthesized ctx.message.text
  ctx.message = { ...ctx.message, text };
  // @ts-ignore private telegraf field access
  await bot.handleUpdate({ update_id: 0, message: ctx.message });
}

bot.on(message('voice'), async (ctx) => {
  try {
    await ctx.reply('🎤 Транскрибирую...');
    const fileId = ctx.message.voice.file_id;
    const link = await ctx.telegram.getFileLink(fileId);
    const res = await fetch(link.href);
    const buf = Buffer.from(await res.arrayBuffer());
    const text = await transcribe(buf, 'voice.ogg');
    if (!text.trim()) return ctx.reply('⚠️ пусто');
    await ctx.reply(`📝 ${text.slice(0, 500)}${text.length > 500 ? '…' : ''}`);
    await dispatchText(ctx, text);
  } catch (err) {
    await ctx.reply(`❌ ${err instanceof Error ? err.message : String(err)}`);
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add apps/claude-ops-bot/src/whisper.ts apps/claude-ops-bot/src/bot.ts
git commit -m "feat(claude-ops-bot): voice messages transcribed and dispatched as text"
```

---

### Task 13: Document + photo handlers

**Files:**
- Modify: `apps/claude-ops-bot/src/bot.ts`

- [ ] **Step 1: Add handlers**

```typescript
import * as fs from 'fs-extra';
import * as path from 'node:path';

bot.on(message('document'), async (ctx) => {
  try {
    const doc = ctx.message.document;
    const link = await ctx.telegram.getFileLink(doc.file_id);
    const res = await fetch(link.href);
    const buf = Buffer.from(await res.arrayBuffer());
    // Save into state dir so Claude can reference it by path
    const outDir = path.join(cfg.stateDir, 'inputs', String(ctx.from!.id));
    await fs.mkdirp(outDir);
    const outPath = path.join(outDir, `${Date.now()}-${doc.file_name ?? 'file'}`);
    await fs.writeFile(outPath, buf);
    await ctx.reply(`📎 сохранён: ${outPath}`);
    await dispatchText(ctx, `Файл доступен локально: ${outPath}\n\n${ctx.message.caption ?? 'Посмотри и действуй.'}`);
  } catch (err) {
    await ctx.reply(`❌ ${err instanceof Error ? err.message : String(err)}`);
  }
});

bot.on(message('photo'), async (ctx) => {
  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1]!;
    const link = await ctx.telegram.getFileLink(photo.file_id);
    const res = await fetch(link.href);
    const buf = Buffer.from(await res.arrayBuffer());
    const outDir = path.join(cfg.stateDir, 'inputs', String(ctx.from!.id));
    await fs.mkdirp(outDir);
    const outPath = path.join(outDir, `${Date.now()}-photo.jpg`);
    await fs.writeFile(outPath, buf);
    await dispatchText(ctx, `Скриншот: ${outPath}\n\n${ctx.message.caption ?? 'Проанализируй.'}`);
  } catch (err) {
    await ctx.reply(`❌ ${err instanceof Error ? err.message : String(err)}`);
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/claude-ops-bot/src/bot.ts
git commit -m "feat(claude-ops-bot): document/photo handlers save input to state dir"
```

---

## Phase 7 — Git safety layer

### Task 14: Diff classifier

**Files:**
- Create: `apps/claude-ops-bot/src/git-safety.ts`
- Create: `apps/claude-ops-bot/tests/git-safety.test.ts`

- [ ] **Step 1: Failing tests**

```typescript
import { classifyDiff } from '../src/git-safety.js';

test('empty diff is small', () => {
  expect(classifyDiff({ files: [], totalChanges: 0 }).kind).toBe('small');
});

test('3 files, 100 lines, non-sensitive — small', () => {
  expect(classifyDiff({
    files: ['apps/web/src/App.tsx', 'apps/web/src/components/X.tsx', 'apps/web/src/components/Y.tsx'],
    totalChanges: 100,
  }).kind).toBe('small');
});

test('4 files — large', () => {
  expect(classifyDiff({
    files: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
    totalChanges: 10,
  }).kind).toBe('large');
});

test('201 lines — large', () => {
  expect(classifyDiff({ files: ['a.ts'], totalChanges: 201 }).kind).toBe('large');
});

test('touches auth file — large', () => {
  const res = classifyDiff({ files: ['packages/api/src/middleware/auth.ts'], totalChanges: 1 });
  expect(res.kind).toBe('large');
  expect(res.reason).toMatch(/blacklist/);
});

test('touches .env — large', () => {
  expect(classifyDiff({ files: ['.env'], totalChanges: 1 }).kind).toBe('large');
});

test('touches package.json — large', () => {
  expect(classifyDiff({ files: ['package.json'], totalChanges: 1 }).kind).toBe('large');
});
```

- [ ] **Step 2: Implement**

```typescript
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
```

- [ ] **Step 3: Tests pass**

- [ ] **Step 4: Commit**

```bash
git add apps/claude-ops-bot/src/git-safety.ts apps/claude-ops-bot/tests/git-safety.test.ts
git commit -m "feat(claude-ops-bot): diff classifier for small vs large changes"
```

---

### Task 15: Git adapter — read status, push, branch, revert

**Files:**
- Modify: `apps/claude-ops-bot/src/git-safety.ts`

- [ ] **Step 1: Add functions**

```typescript
import { spawn } from 'node:child_process';

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
    files.push(parts[2]);
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
  const branch = `claude/${stamp}-${slug.slice(0, 40).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'change'}`;
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
```

- [ ] **Step 2: Commit**

```bash
git add apps/claude-ops-bot/src/git-safety.ts
git commit -m "feat(claude-ops-bot): git adapter for push/park/merge/revert"
```

---

### Task 16: Wire GitSafety into text handler post-round

**Files:**
- Modify: `apps/claude-ops-bot/src/bot.ts`

- [ ] **Step 1: Update text handler (inside the `try` block, after `runner.run`)**

Replace:
```typescript
await ctx.reply(res.exitCode === 0 ? `✅ раунд завершён` : `⚠️ exit ${res.exitCode}`);
```

With:
```typescript
if (res.exitCode !== 0) {
  await ctx.reply(`⚠️ Claude exit ${res.exitCode}`);
} else if (s.activeTarget.type === 'git') {
  const info = await inspectLastCommit(s.activeTarget.path);
  if (!info) {
    await ctx.reply('ℹ️ Claude не сделал коммитов.');
  } else {
    const cls = classifyDiff(info);
    if (cls.kind === 'small') {
      try {
        const sha = await pushMaster(s.activeTarget.path);
        await ctx.reply(`✅ влито в master (${sha}), ${info.files.length} файл(ов), ${info.totalChanges} строк. Deploy в процессе.`);
      } catch (err) {
        await ctx.reply(`❌ push не удался: ${err instanceof Error ? err.message : err}`);
      }
    } else {
      try {
        const slug = text.slice(0, 40);
        const branch = await parkOnBranch(s.activeTarget.path, slug);
        await ctx.reply(`⚠️ Большое изменение (${cls.reason}). Ветка: ${branch}\n/merge ${branch} чтобы влить.`);
      } catch (err) {
        await ctx.reply(`❌ park не удался: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
} else {
  await ctx.reply('✅ раунд завершён (folder target, без git).');
}
```

Add import:
```typescript
import { classifyDiff, inspectLastCommit, pushMaster, parkOnBranch } from './git-safety.js';
```

- [ ] **Step 2: Commit**

```bash
git add apps/claude-ops-bot/src/bot.ts
git commit -m "feat(claude-ops-bot): auto-merge small / park large after each round"
```

---

### Task 17: /merge and /rollback commands

**Files:**
- Modify: `apps/claude-ops-bot/src/bot.ts`

- [ ] **Step 1: Add commands**

```typescript
import { mergeBranch, revertHead } from './git-safety.js';

bot.command('merge', async (ctx) => {
  const s = sessions.get(ctx.from!.id);
  if (!s.activeTarget || s.activeTarget.type !== 'git') return ctx.reply('Нужен активный git-проект.');
  const branch = ctx.message.text.replace(/^\/merge\s*/, '').trim();
  if (!branch.startsWith('claude/')) return ctx.reply('Формат: /merge claude/<name>');
  try {
    await mergeBranch(s.activeTarget.path, branch);
    return ctx.reply(`✅ ${branch} → master`);
  } catch (err) {
    return ctx.reply(`❌ ${err instanceof Error ? err.message : err}`);
  }
});

bot.command('rollback', async (ctx) => {
  const s = sessions.get(ctx.from!.id);
  if (!s.activeTarget) return ctx.reply('Нет активного проекта.');
  if (s.activeTarget.type !== 'git') return ctx.reply('Folder rollback в Phase 8.');
  try {
    const sha = await revertHead(s.activeTarget.path);
    return ctx.reply(`✅ revert, новый HEAD: ${sha}`);
  } catch (err) {
    return ctx.reply(`❌ ${err instanceof Error ? err.message : err}`);
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/claude-ops-bot/src/bot.ts
git commit -m "feat(claude-ops-bot): /merge and /rollback commands"
```

---

## Phase 8 — Folder safety (vault)

### Task 18: Folder snapshots + restore

**Files:**
- Create: `apps/claude-ops-bot/src/folder-safety.ts`
- Create: `apps/claude-ops-bot/tests/folder-safety.test.ts`

- [ ] **Step 1: Failing tests**

```typescript
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
```

- [ ] **Step 2: Implement**

```typescript
import * as path from 'node:path';
import * as fs from 'fs-extra';

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
  const latest = snaps[snaps.length - 1];
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
```

Note: spec mentions hard-linked copies for space savings. `fs.copy` is a regular copy. Hard-link copy across `fs-extra` is not native; leaving the cheap route as plain copy for MVP. Add a TODO to switch to `cp -al` on Linux later.

- [ ] **Step 3: Tests pass**

- [ ] **Step 4: Commit**

```bash
git add apps/claude-ops-bot/src/folder-safety.ts apps/claude-ops-bot/tests/folder-safety.test.ts
git commit -m "feat(claude-ops-bot): folder snapshots + restore"
```

---

### Task 19: Hook folder snapshot before round + folder /rollback

**Files:**
- Modify: `apps/claude-ops-bot/src/bot.ts`

- [ ] **Step 1: Before `const runner = new ClaudeRunner(...)` in text handler**

```typescript
if (s.activeTarget.type === 'folder') {
  await snapshot(s.activeTarget.path, path.join(cfg.stateDir, 'backups'), String(tgId));
  await pruneOldSnapshots(path.join(cfg.stateDir, 'backups'), String(tgId), 5);
}
```

- [ ] **Step 2: Replace folder branch in /rollback with real restore**

```typescript
bot.command('rollback', async (ctx) => {
  const s = sessions.get(ctx.from!.id);
  if (!s.activeTarget) return ctx.reply('Нет активного проекта.');
  if (s.activeTarget.type === 'git') {
    try {
      const sha = await revertHead(s.activeTarget.path);
      return ctx.reply(`✅ revert, новый HEAD: ${sha}`);
    } catch (err) { return ctx.reply(`❌ ${err instanceof Error ? err.message : err}`); }
  }
  try {
    await restoreLatest(s.activeTarget.path, path.join(cfg.stateDir, 'backups'), String(ctx.from!.id));
    return ctx.reply('✅ vault восстановлен из последнего снимка');
  } catch (err) { return ctx.reply(`❌ ${err instanceof Error ? err.message : err}`); }
});
```

Add imports:
```typescript
import { snapshot, pruneOldSnapshots, restoreLatest } from './folder-safety.js';
```

- [ ] **Step 3: Commit**

```bash
git add apps/claude-ops-bot/src/bot.ts
git commit -m "feat(claude-ops-bot): folder targets snapshot before round, /rollback restores"
```

---

## Phase 9 — Deploy

### Task 20: PM2 ecosystem + env on server

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Create: `apps/claude-ops-bot/ecosystem.config.cjs` (optional, or extend existing)

- [ ] **Step 1: Add bot startup to deploy workflow**

Read `.github/workflows/deploy.yml` and add a step after the existing `pm2 restart kanban-api` that does:

```yaml
      - name: Start or restart claude-ops-bot
        run: |
          ssh root@213.139.229.148 "
            cd /var/www/kanban-app
            pnpm install --frozen-lockfile=false
            if pm2 describe claude-ops-bot > /dev/null 2>&1; then
              pm2 restart claude-ops-bot
            else
              pm2 start --name claude-ops-bot --cwd /var/www/kanban-app/apps/claude-ops-bot npm -- start
            fi
            pm2 save
          "
```

Exact yaml structure should match the existing deploy step's style — inspect `deploy.yml` first.

- [ ] **Step 2: Place real .env on server (manual, once)**

Ask Slava to do the following on the server:
```bash
cat > /var/www/kanban-app/apps/claude-ops-bot/.env <<'EOF'
TELEGRAM_OPS_BOT_TOKEN=<paste-from-BotFather>
ALLOWED_TG_ID=849367993
CLAUDE_OPS_STATE_DIR=/root/.claude-ops
SESSION_TIMEOUT_MINUTES=30
DEFAULT_MODEL=sonnet
CLAUDE_BIN=/root/.local/bin/claude
EOF
chmod 600 /var/www/kanban-app/apps/claude-ops-bot/.env
```

- [ ] **Step 3: Add initial whitelist**

Manually on server:
```bash
mkdir -p /root/.claude-ops
cat > /root/.claude-ops/repos.json <<'EOF'
[
  {"name": "kanban", "path": "/var/www/kanban-app", "type": "git"},
  {"name": "vault", "path": "/var/www/kanban-app/vault/user_2", "type": "folder"}
]
EOF
chmod 600 /root/.claude-ops/repos.json
```

- [ ] **Step 4: Commit deploy workflow change**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci(claude-ops-bot): add pm2 start step to production deploy"
```

---

### Task 21: Smoke test end-to-end

- [ ] **Step 1: Push branch to trigger deploy**

```bash
git push origin master
```

- [ ] **Step 2: Wait for GitHub Actions green**

- [ ] **Step 3: Verify process up**

```bash
ssh root@213.139.229.148 "pm2 status claude-ops-bot"
```

Expected: online.

- [ ] **Step 4: Slava tests from TG**

Slava sends `/start` → bot replies.
Slava sends `/repos` → bot lists kanban + vault.
Slava sends `/use kanban` → bot confirms.
Slava sends a tiny task, e.g. "добавь комментарий // hi в начало apps/web/src/App.tsx" → bot streams Claude's work, commits, auto-merges, deploys.
Slava sends `/rollback` → revert committed.

- [ ] **Step 5: Fix anything broken**

Iterate until all four smoke tests pass.

- [ ] **Step 6: Final commit (if fixes needed)**

```bash
git add -A && git commit -m "fix(claude-ops-bot): smoke-test feedback" && git push
```

---

## Follow-up work (NOT in this plan)

These appear in the spec but are deferred to keep the plan shippable:

1. **Auto-inference of project** when whitelist has 2+ entries and user doesn't specify. For MVP we just ask with `/use`. Follow-up plan can add Claude-based classification.
2. **Question-detection heuristic** in ClaudeRunner (detect "Claude is waiting on stdin"). MVP uses one-shot per message; if Claude needs more input Slava just sends another message which is piped as a fresh round in the same cwd.
3. **Tests script enforcement** in small-change classifier — currently not run. Follow-up: run `pnpm test` (or `npm test`) in-band and demote to large if non-zero.
4. **Session persistence** to disk. In-memory only for MVP.
5. **Hard-linked backups** for vault (`cp -al`) for space savings.

---

## Self-review notes

- Spec sections covered in plan: architecture (tasks 1-10), auth (3), state dir layout (2,4), session (6), project resolver (5), commands /repos/use/add_repo/end/stop/status/opus (8,11), text handler (10), voice (12), document/photo (13), git classifier + push/park (14-16), /merge /rollback (17, 19), folder snapshots (18-19), deploy + smoke test (20-21).
- Deferred & explicitly noted: auto-inference, question detection, tests gate in classifier, session persistence, hard-link backups.
- Type consistency: `Target` (name/path/type) used consistently across project-resolver, session, bot.
- No placeholder text; every code step shows real code.
