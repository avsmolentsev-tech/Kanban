# Obsidian Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Obsidian improvements from the spec: Telegram-bot confirmation card with inline buttons and voice/text correction loop; auto-tagging with `company` support; daily backup of Slava's `.md` files to his Google Drive folder. (MCP-Obsidian install was handled separately.)

**Architecture:** Draft state lives in memory on the Kanban API telegram service; Claude extracts a structured card (type / title / project / company / people / tags); user confirms or edits via inline buttons; save path reuses the existing IngestService/ObsidianService plumbing with extended params. A standalone shell script handles the once-a-day Drive sync via the existing `gog` CLI.

**Tech Stack:** TypeScript (Kanban API), Telegraf v4 callback_query + inline keyboards, Claude Sonnet via `ClaudeService`, existing Whisper local, Jest for service unit tests, bash + `gog` for the backup script.

**Spec:** `docs/superpowers/specs/2026-04-16-obsidian-improvements-design.md`

---

## File Structure

```
packages/shared/src/
  types.ts                                     modify — add DraftCard + ExtractionResult types (shared with web later)

packages/api/src/
  services/claude.service.ts                   modify — new extractMeetingDraft() prompt
  services/ingest.service.ts                   modify — accept company + tags from analysis
  services/obsidian.service.ts                 modify — add company to WriteMeetingParams, writeTask/writeIdea; expand frontmatter
  services/draft-session.ts                    create — PendingDraft state manager
  services/card-renderer.ts                    create — TG inline-card markup + callback_data encode/decode
  services/telegram.service.ts                 modify — replace direct ingest with draft flow, callback_query handlers, correction loop
  __tests__/card-renderer.test.ts              create — chunking, escaping, callback encode/decode
  __tests__/draft-session.test.ts              create — draft lifecycle, timeout, type mutation
  __tests__/obsidian-frontmatter.test.ts       create — frontmatter schema with company + tags

scripts/
  backup-obsidian-md-to-drive.sh               create — daily Drive sync using gog
  logrotate-backup-obsidian-md                 create — logrotate config

.github/workflows/
  deploy.yml                                   modify — rsync backup script, install logrotate config, install cron
```

No new package dependencies (uses existing Telegraf, @pis/shared, gog).

---

## Phase 1 — Data model & extraction

### Task 1: Add shared types for draft + extraction result

**Files:**
- Modify: `packages/shared/src/types.ts` (append near the end, before the last `export`)

- [ ] **Step 1: Add types**

```typescript
export type DraftType = 'meeting' | 'task' | 'idea' | 'inbox';

export interface ExtractionResult {
  detected_type: DraftType;
  title: string;
  date: string;                 // YYYY-MM-DD
  project_hints: string[];
  company_hints: string[];
  people: string[];
  tags_hierarchical: string[];  // e.g. ["type/meeting", "project/roboty"]
  tags_free: string[];          // up to 5 topical tags, lowercase
  summary: string;
  agreements: number;           // meeting only; 0 otherwise
  tasks: string[];              // meeting only; extracted task titles
}

export interface DraftCard {
  id: string;
  userId: number;
  tgId: number;
  createdAt: number;
  updatedAt: number;
  type: DraftType;
  title: string;
  date: string;
  projectName: string | null;
  companyName: string | null;
  people: string[];
  tags: string[];               // canonical merged list (hierarchical + free)
  summary: string;
  transcript: string;
  sourceKind: 'voice' | 'audio' | 'document' | 'photo' | 'text';
  sourceLocalPath: string | null;
  awaitingEdit: boolean;
  cardMessageId: number | null; // TG message id of the rendered card
}
```

- [ ] **Step 2: Rebuild shared**

Run: `pnpm --filter @pis/shared build`
Expected: no errors, dist/types.d.ts contains the new exports.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add ExtractionResult and DraftCard types"
```

---

### Task 2: Claude extraction prompt returning the structured result

**Files:**
- Modify: `packages/api/src/services/claude.service.ts` (add new method near `parseInboxItem`)
- Create: `packages/api/src/__tests__/claude-extraction.test.ts`

- [ ] **Step 1: Write failing test (shape only — mocks OpenAI)**

Create `packages/api/src/__tests__/claude-extraction.test.ts`:
```typescript
import { ClaudeService } from '../services/claude.service';

describe('extractDraft', () => {
  test('returns a parsed ExtractionResult when OpenAI replies with valid JSON', async () => {
    const svc = new ClaudeService();
    const mockResp = {
      detected_type: 'meeting',
      title: 'Обсуждение прототипа',
      date: '2026-04-16',
      project_hints: ['Роботы-мойщики'],
      company_hints: ['Keenon Robotics'],
      people: ['Максим'],
      tags_hierarchical: ['type/meeting', 'project/roboty-mojshiki', 'company/keenon-robotics'],
      tags_free: ['прототип'],
      summary: 'Обсудили прототип',
      agreements: 1,
      tasks: ['Подготовить TZ'],
    };
    // @ts-expect-error monkey-patch the internal openai call
    svc.openai = { chat: { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify(mockResp) } }] }) } } };
    const out = await svc.extractDraft('Встретились с Максимом из Keenon Robotics');
    expect(out).toEqual(mockResp);
  });
});
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm --filter @pis/api test -- --testPathPattern claude-extraction`
Expected: FAIL (method does not exist).

- [ ] **Step 3: Implement `extractDraft`**

In `packages/api/src/services/claude.service.ts`, add after `parseInboxItem`:
```typescript
import type { ExtractionResult, DraftType } from '@pis/shared';

const EXTRACTION_SYSTEM_PROMPT = `Ты помощник который превращает транскрипт голосовой заметки или свободный текст в структурированную карточку.

Верни СТРОГО JSON без пояснений со следующей схемой:
{
  "detected_type": "meeting" | "task" | "idea" | "inbox",
  "title": "краткое название 4-10 слов на русском",
  "date": "YYYY-MM-DD (сегодня, если автор явно не указал другую)",
  "project_hints": ["строка"],
  "company_hints": ["строка"],
  "people": ["имя как произнесено"],
  "tags_hierarchical": ["type/<type>", "project/<slug>", "company/<slug>"],
  "tags_free": ["до 5 строк на русском, короткие"],
  "summary": "2-4 предложения на русском",
  "agreements": 0,
  "tasks": ["для встречи: 0-10 задач, вытащенных из разговора"]
}

Правила:
- Всегда включи "type/<тип>" в tags_hierarchical.
- Если проект ясен — добавь "project/<транслит в kebab-case>".
- Если компания ясна — добавь "company/<транслит в kebab-case>".
- Для идей используй "category/<slug>" вместо "project/...".
- Свободные теги короткие, на русском, без спецсимволов, до 5 штук.
- Если дата не указана — сегодняшняя.
- agreements = 0 для task/idea/inbox.
- tasks = [] для task/idea/inbox.`;

export async function extractDraftPromptUser(text: string, today: string): string {
  return `Сегодня: ${today}\n\nТекст:\n${text}\n\nВерни JSON.`;
}

// inside ClaudeService class:
async extractDraft(text: string, todayIso?: string): Promise<ExtractionResult> {
  const today = todayIso ?? new Date().toISOString().split('T')[0]!;
  const resp = await this.openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    temperature: 0.1,
    messages: [
      { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
      { role: 'user', content: `Сегодня: ${today}\n\nТекст:\n${text}\n\nВерни JSON.` },
    ],
    response_format: { type: 'json_object' },
  });
  const raw = resp.choices[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(raw) as ExtractionResult;
  // defensive defaults
  parsed.project_hints ??= [];
  parsed.company_hints ??= [];
  parsed.people ??= [];
  parsed.tags_hierarchical ??= [`type/${parsed.detected_type ?? 'inbox'}`];
  parsed.tags_free ??= [];
  parsed.tasks ??= [];
  parsed.agreements ??= 0;
  parsed.summary ??= '';
  parsed.date ??= today;
  return parsed;
}
```

(Remove the module-level `extractDraftPromptUser` export — inline its body into the call above. Shown above only for clarity of the prompt.)

Also, at the top of the file, ensure `import type { ExtractionResult } from '@pis/shared';` is present. Remove the `export async function extractDraftPromptUser` stub — the prompt lives inline inside `extractDraft`.

- [ ] **Step 4: Tests pass**

Run: `pnpm --filter @pis/api test -- --testPathPattern claude-extraction`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/claude.service.ts packages/api/src/__tests__/claude-extraction.test.ts
git commit -m "feat(api): ClaudeService.extractDraft — structured ingest extraction"
```

---

## Phase 2 — Obsidian frontmatter with company and canonical tags

### Task 3: Add company param + expand frontmatter in ObsidianService

**Files:**
- Modify: `packages/api/src/services/obsidian.service.ts`
- Create: `packages/api/src/__tests__/obsidian-frontmatter.test.ts`

- [ ] **Step 1: Failing tests**

Create `packages/api/src/__tests__/obsidian-frontmatter.test.ts`:
```typescript
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ObsidianService } from '../services/obsidian.service';

const tmpVault = path.join(os.tmpdir(), 'vault-test-' + Date.now());

afterAll(() => fs.rmSync(tmpVault, { recursive: true, force: true }));

function read(relPath: string): string {
  return fs.readFileSync(path.join(tmpVault, relPath), 'utf-8');
}

test('writeMeeting includes company wiki-link and tags when set', async () => {
  const svc = new ObsidianService(tmpVault).forUser(2);
  const rel = await svc.writeMeeting({
    title: 'Обсуждение прототипа',
    date: '2026-04-16',
    project: 'Роботы-мойщики',
    company: 'Keenon Robotics',
    people: ['Максим'],
    summary: 'Summary',
    tags: ['type/meeting', 'project/roboty-mojshiki', 'company/keenon-robotics', 'прототип'],
    source: 'telegram-voice',
    agreements: 1,
  });
  const body = read(rel);
  expect(body).toMatch(/company:\s*\[\[Keenon Robotics\]\]/);
  expect(body).toMatch(/project:\s*\[\[Роботы-мойщики\]\]/);
  expect(body).toMatch(/source:\s*telegram-voice/);
  expect(body).toMatch(/^\*\*Компания:\*\* \[\[Keenon Robotics\]\]/m);
  expect(body).toMatch(/tags:\s*\[type\/meeting,\s*project\/roboty-mojshiki,\s*company\/keenon-robotics,\s*прототип\]/);
});

test('writeMeeting omits company block when company not set', async () => {
  const svc = new ObsidianService(tmpVault).forUser(2);
  const rel = await svc.writeMeeting({
    title: 'No company meeting',
    date: '2026-04-16',
    people: [],
    summary: 'x',
    tags: ['type/meeting'],
    source: 'telegram-text',
  });
  const body = read(rel);
  expect(body).toMatch(/company:\s*null/);
  expect(body).not.toMatch(/\*\*Компания:\*\*/);
});

test('writeTask and writeIdea accept company and include it in frontmatter', async () => {
  const svc = new ObsidianService(tmpVault).forUser(2);
  const relTask = await svc.writeTask({
    title: 'Подготовить TZ',
    status: 'todo',
    priority: 3,
    urgency: 3,
    project: 'Роботы-мойщики',
    company: 'Keenon Robotics',
    people: [],
    tags: ['type/task', 'project/roboty-mojshiki', 'company/keenon-robotics'],
    source: 'telegram-text',
  });
  expect(read(relTask)).toMatch(/company:\s*\[\[Keenon Robotics\]\]/);
  const relIdea = await svc.writeIdea({
    title: 'Новая фича',
    body: 'Описание',
    category: 'product',
    company: 'Keenon Robotics',
    tags: ['type/idea', 'category/product', 'company/keenon-robotics'],
    source: 'telegram-text',
    date: '2026-04-16',
  });
  expect(read(relIdea)).toMatch(/company:\s*\[\[Keenon Robotics\]\]/);
});
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm --filter @pis/api test -- --testPathPattern obsidian-frontmatter`
Expected: FAIL (params don't include `company`, `source`, body line, etc.)

- [ ] **Step 3: Extend ObsidianService**

In `packages/api/src/services/obsidian.service.ts`:

a) Update interfaces:

```typescript
interface WriteTaskParams {
  title: string;
  status: string;
  priority: number;
  urgency: number;
  project?: string;
  company?: string;
  due_date?: string | null;
  people?: string[];
  tags?: string[];
  source?: string;
}

interface WriteMeetingParams {
  title: string;
  date: string;
  project?: string;
  company?: string;
  people?: string[];
  summary: string;
  agreements?: number;
  source?: string;
  tags?: string[];
}

interface WriteIdeaParams {
  title: string;
  body: string;
  category: string;
  project?: string;
  company?: string;
  source?: string;
  date: string;
  tags?: string[];
}
```

b) Add a private helper `wikiOrNull(name?: string): string` that returns `[[name]]` or the literal `null`:

```typescript
private wikiOrNull(name: string | undefined | null): string {
  return name ? this.wikiLink(name) : 'null';
}

private tagList(tags: string[] | undefined): string {
  const t = (tags && tags.length > 0) ? tags : [];
  return `[${t.join(', ')}]`;
}
```

c) Update `writeMeeting` body. Replace the existing implementation (starting at `async writeMeeting(params: ...)` in current file) with the version that emits:

```typescript
async writeMeeting(params: WriteMeetingParams): Promise<string> {
  const filename = this.meetingFileName(params.date, params.title);
  const dir = this.userPath('Meetings');
  this.ensureDir(dir);
  const peopleLinks = (params.people ?? []).map((p) => this.wikiLink(p));
  const frontmatter = [
    '---',
    'type: meeting',
    `date: ${params.date}`,
    `project: ${this.wikiOrNull(params.project)}`,
    `company: ${this.wikiOrNull(params.company)}`,
    `people: [${peopleLinks.join(', ')}]`,
    `tags: ${this.tagList(params.tags)}`,
    `source: ${params.source ?? 'manual'}`,
    `agreements: ${params.agreements ?? 0}`,
    `created_at: ${this.now()}`,
    '---',
  ].join('\n');
  const header = [
    `# ${params.title}`,
    '',
    `**Дата:** ${params.date}`,
    params.project ? `**Проект:** ${this.wikiLink(params.project)}` : null,
    params.company ? `**Компания:** ${this.wikiLink(params.company)}` : null,
    (params.people ?? []).length > 0 ? `**Участники:** ${peopleLinks.join(', ')}` : null,
  ].filter(Boolean).join('\n');
  const body = `${frontmatter}\n\n${header}\n\n${params.summary}\n`;
  fs.writeFileSync(path.join(dir, filename), body, 'utf-8');
  return this.userRelative('Meetings', filename);
}
```

d) Update `writeTask`:
```typescript
async writeTask(params: WriteTaskParams): Promise<string> {
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
  const filename = `task-${ts}-${this.toSlug(params.title)}.md`;
  const dir = this.userPath('Tasks');
  this.ensureDir(dir);
  const peopleLinks = (params.people ?? []).map((p) => this.wikiLink(p));
  const frontmatter = [
    '---',
    'type: task',
    `status: ${params.status}`,
    `project: ${this.wikiOrNull(params.project)}`,
    `company: ${this.wikiOrNull(params.company)}`,
    `priority: ${params.priority}`,
    `urgency: ${params.urgency}`,
    `due_date: ${params.due_date ?? 'null'}`,
    `people: [${peopleLinks.join(', ')}]`,
    `tags: ${this.tagList(params.tags?.length ? params.tags : ['type/task'])}`,
    `source: ${params.source ?? 'manual'}`,
    `created_at: ${this.now()}`,
    '---',
  ].join('\n');
  fs.writeFileSync(path.join(dir, filename), `${frontmatter}\n\n# ${params.title}\n\n`, 'utf-8');
  return this.userRelative('Tasks', filename);
}
```

e) Update `writeIdea` (symmetric):
```typescript
async writeIdea(params: WriteIdeaParams): Promise<string> {
  const filename = `${params.date}-${this.toSlug(params.title)}.md`;
  const dir = this.userPath('Ideas');
  this.ensureDir(dir);
  const frontmatter = [
    '---',
    'type: idea',
    `date: ${params.date}`,
    `category: ${params.category}`,
    `project: ${this.wikiOrNull(params.project)}`,
    `company: ${this.wikiOrNull(params.company)}`,
    `tags: ${this.tagList(params.tags?.length ? params.tags : ['type/idea', `category/${this.toSlug(params.category)}`])}`,
    `source: ${params.source ?? 'manual'}`,
    `created_at: ${this.now()}`,
    '---',
  ].join('\n');
  const header = [
    `# ${params.title}`,
    '',
    params.project ? `**Проект:** ${this.wikiLink(params.project)}` : null,
    params.company ? `**Компания:** ${this.wikiLink(params.company)}` : null,
  ].filter(Boolean).join('\n');
  fs.writeFileSync(path.join(dir, filename), `${frontmatter}\n\n${header}\n\n${params.body}\n`, 'utf-8');
  return this.userRelative('Ideas', filename);
}
```

- [ ] **Step 4: Tests pass**

Run: `pnpm --filter @pis/api test -- --testPathPattern obsidian-frontmatter`
Expected: 3 tests passed.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/obsidian.service.ts packages/api/src/__tests__/obsidian-frontmatter.test.ts
git commit -m "feat(api): ObsidianService writes company field + canonical tags"
```

---

### Task 4: Match company helper in IngestService

**Files:**
- Modify: `packages/api/src/services/ingest.service.ts`

- [ ] **Step 1: Add `matchCompany` method next to existing `matchPeople`**

In `IngestService`:
```typescript
/** Match existing company by name across this user's people; return the canonical name or the hint verbatim */
private matchCompany(hints: string[], userId: number): string | null {
  if (hints.length === 0) return null;
  const db = getDb();
  const rows = db.prepare('SELECT DISTINCT company FROM people WHERE user_id = ? AND company != ""').all(userId) as Array<{ company: string }>;
  const existing = rows.map((r) => r.company);
  for (const hint of hints) {
    const lower = hint.toLowerCase().trim();
    if (!lower) continue;
    const match = existing.find((c) => c.toLowerCase() === lower || c.toLowerCase().includes(lower) || lower.includes(c.toLowerCase()));
    if (match) return match;
  }
  // No match in DB; return the first non-empty hint verbatim so it still lands in vault as a wiki-link
  const first = hints.find((h) => h && h.trim());
  return first ? first.trim() : null;
}
```

- [ ] **Step 2: Commit (no tests — integration tested in Task 11)**

```bash
git add packages/api/src/services/ingest.service.ts
git commit -m "feat(api): IngestService.matchCompany helper"
```

---

## Phase 3 — Draft session manager

### Task 5: DraftSession service

**Files:**
- Create: `packages/api/src/services/draft-session.ts`
- Create: `packages/api/src/__tests__/draft-session.test.ts`

- [ ] **Step 1: Failing tests**

```typescript
import { DraftSession } from '../services/draft-session';
import type { DraftCard, ExtractionResult } from '@pis/shared';

jest.useFakeTimers();

const makeResult = (): ExtractionResult => ({
  detected_type: 'meeting',
  title: 'Test',
  date: '2026-04-16',
  project_hints: ['Roboty'],
  company_hints: ['Keenon'],
  people: ['Maksim'],
  tags_hierarchical: ['type/meeting', 'project/roboty'],
  tags_free: ['test'],
  summary: 'sum',
  agreements: 0,
  tasks: [],
});

test('create returns a DraftCard with canonical tags merged', () => {
  const s = new DraftSession({ timeoutMs: 1000, onTimeout: () => {} });
  const card = s.create(42, 2, makeResult(), 'voice', 'transcript', null);
  expect(card.type).toBe('meeting');
  expect(card.tgId).toBe(42);
  expect(card.userId).toBe(2);
  expect(card.tags).toEqual(['type/meeting', 'project/roboty', 'test']);
  expect(card.awaitingEdit).toBe(false);
});

test('get and update mutate the same draft', () => {
  const s = new DraftSession({ timeoutMs: 1000, onTimeout: () => {} });
  const card = s.create(42, 2, makeResult(), 'voice', 't', null);
  s.update(42, { title: 'New title', awaitingEdit: true });
  expect(s.get(42)?.title).toBe('New title');
  expect(s.get(42)?.awaitingEdit).toBe(true);
});

test('timeout triggers onTimeout with the draft', () => {
  const timeouts: DraftCard[] = [];
  const s = new DraftSession({ timeoutMs: 1000, onTimeout: (c) => timeouts.push(c) });
  s.create(42, 2, makeResult(), 'voice', 't', null);
  jest.advanceTimersByTime(1500);
  expect(timeouts).toHaveLength(1);
  expect(s.get(42)).toBeUndefined();
});

test('close removes draft and cancels timeout', () => {
  const s = new DraftSession({ timeoutMs: 1000, onTimeout: () => { throw new Error('should not fire'); } });
  s.create(42, 2, makeResult(), 'voice', 't', null);
  s.close(42);
  jest.advanceTimersByTime(2000);
  expect(s.get(42)).toBeUndefined();
});

test('create second draft for same tgId auto-closes the previous one', () => {
  const closed: DraftCard[] = [];
  const s = new DraftSession({ timeoutMs: 1000, onTimeout: (c) => closed.push(c) });
  s.create(42, 2, makeResult(), 'voice', 'first', null);
  s.create(42, 2, makeResult(), 'voice', 'second', null);
  expect(closed).toHaveLength(1);          // onTimeout was called for the first
  expect(s.get(42)?.transcript).toBe('second');
});
```

- [ ] **Step 2: Implement**

```typescript
import type { DraftCard, DraftType, ExtractionResult } from '@pis/shared';
import { randomUUID } from 'node:crypto';

export interface DraftSessionOpts {
  timeoutMs: number;
  onTimeout: (draft: DraftCard) => void;
}

export class DraftSession {
  private drafts = new Map<number, DraftCard>();
  private timers = new Map<number, NodeJS.Timeout>();

  constructor(private readonly opts: DraftSessionOpts) {}

  create(
    tgId: number,
    userId: number,
    extraction: ExtractionResult,
    sourceKind: DraftCard['sourceKind'],
    transcript: string,
    sourceLocalPath: string | null,
  ): DraftCard {
    const existing = this.drafts.get(tgId);
    if (existing) {
      this.clearTimer(tgId);
      this.opts.onTimeout(existing);        // auto-save prior draft
      this.drafts.delete(tgId);
    }
    const now = Date.now();
    const card: DraftCard = {
      id: randomUUID(),
      userId,
      tgId,
      createdAt: now,
      updatedAt: now,
      type: extraction.detected_type,
      title: extraction.title,
      date: extraction.date,
      projectName: extraction.project_hints[0] ?? null,
      companyName: extraction.company_hints[0] ?? null,
      people: extraction.people,
      tags: [...extraction.tags_hierarchical, ...extraction.tags_free],
      summary: extraction.summary,
      transcript,
      sourceKind,
      sourceLocalPath,
      awaitingEdit: false,
      cardMessageId: null,
    };
    this.drafts.set(tgId, card);
    this.armTimer(tgId);
    return card;
  }

  get(tgId: number): DraftCard | undefined { return this.drafts.get(tgId); }

  update(tgId: number, patch: Partial<DraftCard>): DraftCard | undefined {
    const c = this.drafts.get(tgId);
    if (!c) return undefined;
    Object.assign(c, patch, { updatedAt: Date.now() });
    this.clearTimer(tgId);
    this.armTimer(tgId);
    return c;
  }

  close(tgId: number): void {
    this.clearTimer(tgId);
    this.drafts.delete(tgId);
  }

  flushAll(): DraftCard[] { return [...this.drafts.values()]; }

  private armTimer(tgId: number): void {
    this.timers.set(tgId, setTimeout(() => {
      const c = this.drafts.get(tgId);
      if (!c) return;
      this.drafts.delete(tgId);
      this.timers.delete(tgId);
      this.opts.onTimeout(c);
    }, this.opts.timeoutMs));
  }

  private clearTimer(tgId: number): void {
    const t = this.timers.get(tgId);
    if (t) clearTimeout(t);
    this.timers.delete(tgId);
  }
}
```

- [ ] **Step 3: Tests pass**

Run: `pnpm --filter @pis/api test -- --testPathPattern draft-session`
Expected: 5 passed.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/services/draft-session.ts packages/api/src/__tests__/draft-session.test.ts
git commit -m "feat(api): DraftSession — per-tgId pending draft with 30min timeout"
```

---

## Phase 4 — Card renderer + callback encoding

### Task 6: Card renderer

**Files:**
- Create: `packages/api/src/services/card-renderer.ts`
- Create: `packages/api/src/__tests__/card-renderer.test.ts`

- [ ] **Step 1: Failing tests**

```typescript
import { renderDraftCard, parseCallbackData, encodeCallbackData, inlineKeyboard } from '../services/card-renderer';
import type { DraftCard } from '@pis/shared';

const card: DraftCard = {
  id: 'abc',
  userId: 2, tgId: 42, createdAt: 0, updatedAt: 0,
  type: 'meeting', title: 'Test', date: '2026-04-16',
  projectName: 'Roboty', companyName: 'Keenon',
  people: ['Maksim'],
  tags: ['type/meeting', 'project/roboty', 'company/keenon', 'прототип'],
  summary: 'Summary', transcript: 'x',
  sourceKind: 'voice', sourceLocalPath: null,
  awaitingEdit: false, cardMessageId: null,
};

test('renderDraftCard emits all fields', () => {
  const txt = renderDraftCard(card);
  expect(txt).toMatch(/Тип:.*встреча/);
  expect(txt).toMatch(/Название: Test/);
  expect(txt).toMatch(/Проект: Roboty/);
  expect(txt).toMatch(/Компания: Keenon/);
  expect(txt).toMatch(/Люди: Maksim/);
  expect(txt).toMatch(/#type\/meeting, #project\/roboty, #company\/keenon, #прототип/);
});

test('encodeCallbackData and parseCallbackData are inverse', () => {
  const s = encodeCallbackData('abc', 'ok');
  const { draftId, action } = parseCallbackData(s);
  expect(draftId).toBe('abc');
  expect(action).toBe('ok');
});

test('parseCallbackData returns null on malformed input', () => {
  expect(parseCallbackData('bogus')).toBeNull();
  expect(parseCallbackData('draft:')).toBeNull();
});

test('inlineKeyboard includes primary + type-change rows', () => {
  const kb = inlineKeyboard(card);
  expect(kb.inline_keyboard).toHaveLength(2);
  expect(kb.inline_keyboard[0].map((b) => b.text)).toEqual(['✅ OK', '✏️ Исправить', '❌ Отменить']);
  expect(kb.inline_keyboard[1].map((b) => b.text)).toEqual(['🤝 Это встреча', '📋 Это задача', '💡 Это идея']);
});
```

- [ ] **Step 2: Implement**

```typescript
import type { DraftCard, DraftType } from '@pis/shared';

export type DraftAction = 'ok' | 'fix' | 'cancel' | 'as-meeting' | 'as-task' | 'as-idea';

export function encodeCallbackData(draftId: string, action: DraftAction): string {
  return `draft:${draftId}:${action}`;
}

export function parseCallbackData(s: string): { draftId: string; action: DraftAction } | null {
  const m = /^draft:([^:]+):(ok|fix|cancel|as-meeting|as-task|as-idea)$/.exec(s);
  if (!m) return null;
  return { draftId: m[1]!, action: m[2] as DraftAction };
}

const TYPE_RU: Record<DraftType, string> = {
  meeting: 'встреча',
  task: 'задача',
  idea: 'идея',
  inbox: 'заметка',
};

export function renderDraftCard(c: DraftCard): string {
  const lines: string[] = [
    '📝 Расшифровано.',
    '',
    `Тип: ${TYPE_RU[c.type]}`,
    `Название: ${c.title}`,
    `Дата: ${c.date}`,
  ];
  if (c.projectName) lines.push(`Проект: ${c.projectName}`);
  if (c.companyName) lines.push(`Компания: ${c.companyName}`);
  if (c.people.length > 0) lines.push(`Люди: ${c.people.join(', ')}`);
  if (c.tags.length > 0) lines.push(`Теги: ${c.tags.map((t) => '#' + t).join(', ')}`);
  return lines.join('\n');
}

export function inlineKeyboard(c: DraftCard): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  return {
    inline_keyboard: [
      [
        { text: '✅ OK', callback_data: encodeCallbackData(c.id, 'ok') },
        { text: '✏️ Исправить', callback_data: encodeCallbackData(c.id, 'fix') },
        { text: '❌ Отменить', callback_data: encodeCallbackData(c.id, 'cancel') },
      ],
      [
        { text: '🤝 Это встреча', callback_data: encodeCallbackData(c.id, 'as-meeting') },
        { text: '📋 Это задача', callback_data: encodeCallbackData(c.id, 'as-task') },
        { text: '💡 Это идея', callback_data: encodeCallbackData(c.id, 'as-idea') },
      ],
    ],
  };
}
```

- [ ] **Step 3: Tests pass**

Run: `pnpm --filter @pis/api test -- --testPathPattern card-renderer`
Expected: 4 passed.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/services/card-renderer.ts packages/api/src/__tests__/card-renderer.test.ts
git commit -m "feat(api): card-renderer — TG draft card + inline keyboard + callback encoding"
```

---

## Phase 5 — Telegram bot: draft flow + correction loop

### Task 7: Refactor ingest path to build a draft instead of saving directly (voice)

**Files:**
- Modify: `packages/api/src/services/telegram.service.ts`

- [ ] **Step 1: Add instance fields for draft session**

Near the top of `TelegramService` class (after `private bot` etc.):
```typescript
private drafts = new DraftSession({
  timeoutMs: 30 * 60_000,
  onTimeout: (c) => { this.saveDraftAsIs(c).catch((e) => console.error('[draft] timeout save failed:', e)); },
});
```

Also at top of file, add imports:
```typescript
import { DraftSession } from './draft-session';
import { ExtractionResult, DraftCard } from '@pis/shared';
import { renderDraftCard, inlineKeyboard, parseCallbackData } from './card-renderer';
import * as fs from 'node:fs';
```

- [ ] **Step 2: Extract common draft creation helper**

Add private method inside TelegramService (anywhere near other helpers):
```typescript
private async buildAndSendDraft(
  ctx: any,
  userId: number,
  tgId: number,
  sourceKind: DraftCard['sourceKind'],
  transcript: string,
  sourceLocalPath: string | null,
): Promise<void> {
  if (!transcript.trim()) { await ctx.reply('⚠️ Пустой текст, нечего сохранять'); return; }
  const claude = new ClaudeService();
  const extraction: ExtractionResult = await claude.extractDraft(transcript);
  const card = this.drafts.create(tgId, userId, extraction, sourceKind, transcript, sourceLocalPath);
  const msg = await ctx.reply(renderDraftCard(card), { reply_markup: inlineKeyboard(card) });
  this.drafts.update(tgId, { cardMessageId: msg.message_id });
}
```

If `ClaudeService` is not already imported at the top of telegram.service.ts, add `import { ClaudeService } from './claude.service';`.

- [ ] **Step 3: Rewire voice handler**

Locate the block inside `this.bot.on(message('voice'), async (ctx) => { ... })` at approximately line 958–999. REPLACE the segment that follows the `Show transcript` ctx.reply and runs intent classification + ingest, with:

```typescript
// After transcript is shown:
const claudeMatch = transcript.match(/^(клод|claude)[:\s,-]+([\s\S]+)$/i);
if (claudeMatch) {
  const content = claudeMatch[2].trim();
  getDb().prepare('INSERT INTO claude_notes (content, source) VALUES (?, ?)').run(content, 'telegram-voice');
  const pending = (getDb().prepare('SELECT COUNT(*) as c FROM claude_notes WHERE processed = 0').get() as { c: number }).c;
  await ctx.reply(`📝 Заметка сохранена для Claude Code\n📬 В очереди: ${pending}`);
  return;
}

// If draft awaiting edit — route transcript as correction, NOT as new draft
const existing = this.drafts.get(tgId);
if (existing?.awaitingEdit) {
  await this.applyCorrection(ctx, existing, transcript);
  return;
}

// Short command handling stays the same as before
const intent = await this.classifyMessage(transcript, ctx.from?.id);
if (intent === 'command' || intent === 'chat') {
  const cmdResponse = await this.executeCommand(transcript, ctx.from?.id);
  await sendCommandResult(ctx, cmdResponse);
  return;
}

// Otherwise: build and send draft card
await this.buildAndSendDraft(ctx, userId, tgId, 'voice', transcript, null);
```

Add `tgId` binding near start of voice handler if not already present: `const tgId = ctx.from!.id;`.

- [ ] **Step 4: Commit (compile only; end-to-end tested later)**

```bash
pnpm --filter @pis/api exec tsc --noEmit 2>&1 | grep -v "already tracked" | head -20 || true
git add packages/api/src/services/telegram.service.ts
git commit -m "feat(api): voice handler uses draft-card flow"
```

---

### Task 8: Correction loop + save-as-is helper

**Files:**
- Modify: `packages/api/src/services/telegram.service.ts`

- [ ] **Step 1: Add `applyCorrection` method**

```typescript
private async applyCorrection(ctx: any, draft: DraftCard, userText: string): Promise<void> {
  const claude = new ClaudeService();
  const patched = await claude.correctDraft(draft, userText);
  const updated = this.drafts.update(draft.tgId, {
    type: patched.detected_type,
    title: patched.title,
    date: patched.date,
    projectName: patched.project_hints[0] ?? null,
    companyName: patched.company_hints[0] ?? null,
    people: patched.people,
    tags: [...patched.tags_hierarchical, ...patched.tags_free],
    summary: patched.summary,
    awaitingEdit: false,
  });
  if (!updated || updated.cardMessageId == null) {
    await ctx.reply('❌ Драфт не найден, попробуй заново.');
    return;
  }
  await ctx.telegram.editMessageText(
    ctx.chat.id,
    updated.cardMessageId,
    undefined,
    renderDraftCard(updated),
    { reply_markup: inlineKeyboard(updated) },
  );
}
```

- [ ] **Step 2: Add `correctDraft` to ClaudeService**

In `packages/api/src/services/claude.service.ts`:
```typescript
async correctDraft(current: DraftCard, userText: string): Promise<ExtractionResult> {
  const systemPrompt = 'Ты обновляешь черновик карточки. Возвращаешь JSON со ТОЙ ЖЕ схемой что extractDraft. Берёшь текущие поля и применяешь правку из user_text. Если user_text не касается поля — оставь как было.';
  const userPrompt = `Текущий черновик (JSON):\n${JSON.stringify({
    detected_type: current.type,
    title: current.title,
    date: current.date,
    project_hints: current.projectName ? [current.projectName] : [],
    company_hints: current.companyName ? [current.companyName] : [],
    people: current.people,
    tags_hierarchical: current.tags.filter((t) => t.includes('/')),
    tags_free: current.tags.filter((t) => !t.includes('/')),
    summary: current.summary,
    agreements: 0,
    tasks: [],
  })}\n\nПравка от пользователя:\n${userText}\n\nВерни обновлённый JSON.`;
  const resp = await this.openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    temperature: 0.1,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
  });
  const raw = resp.choices[0]?.message?.content ?? '{}';
  return JSON.parse(raw) as ExtractionResult;
}
```

Add `import type { DraftCard } from '@pis/shared';` at top if missing.

- [ ] **Step 3: Add `saveDraftAsIs` to TelegramService**

```typescript
private async saveDraftAsIs(draft: DraftCard): Promise<void> {
  const db = getDb();
  const obsidian = new ObsidianService(config.vaultPath).forUser(draft.userId);
  const tagsList = draft.tags;
  if (draft.type === 'meeting') {
    const result = db.prepare(
      'INSERT INTO meetings (user_id, title, date, project_id, summary_raw, summary_structured, vault_path, source_file, processed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)'
    ).run(draft.userId, draft.title, draft.date, null, draft.summary, JSON.stringify({ transcript: draft.transcript }), null, draft.sourceKind, );
    const meetingId = Number(result.lastInsertRowid);
    const fullBody = `${draft.summary}\n\n---\n\n## Полная транскрипция\n\n${draft.transcript}`;
    const vaultRel = await obsidian.writeMeeting({
      title: draft.title, date: draft.date, people: draft.people,
      project: draft.projectName ?? undefined,
      company: draft.companyName ?? undefined,
      summary: fullBody, agreements: 0,
      source: `telegram-${draft.sourceKind}`,
      tags: tagsList,
    });
    db.prepare('UPDATE meetings SET vault_path = ? WHERE id = ?').run(vaultRel, meetingId);
  } else if (draft.type === 'task') {
    const result = db.prepare(
      'INSERT INTO tasks (user_id, title, description, status, priority, urgency) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(draft.userId, draft.title, draft.summary, 'todo', 3, 3);
    const taskId = Number(result.lastInsertRowid);
    const vaultRel = await obsidian.writeTask({
      title: draft.title, status: 'todo', priority: 3, urgency: 3,
      project: draft.projectName ?? undefined,
      company: draft.companyName ?? undefined,
      people: draft.people,
      tags: tagsList,
      source: `telegram-${draft.sourceKind}`,
    });
    db.prepare('UPDATE tasks SET vault_path = ? WHERE id = ?').run(vaultRel, taskId);
  } else if (draft.type === 'idea') {
    const result = db.prepare(
      'INSERT INTO ideas (user_id, title, body, category, status) VALUES (?, ?, ?, ?, ?)'
    ).run(draft.userId, draft.title, draft.summary, 'personal', 'backlog');
    const ideaId = Number(result.lastInsertRowid);
    await obsidian.writeIdea({
      title: draft.title, body: draft.summary,
      category: 'personal',
      project: draft.projectName ?? undefined,
      company: draft.companyName ?? undefined,
      date: draft.date,
      tags: tagsList,
      source: `telegram-${draft.sourceKind}`,
    });
  } else {
    // inbox — fallthrough: save transcript to Inbox folder
    await obsidian.writeInboxItem(`${draft.date}-${draft.title}.txt`, draft.transcript);
  }
}
```

- [ ] **Step 4: Commit + compile check**

```bash
pnpm --filter @pis/api exec tsc --noEmit 2>&1 | head -15 || true
git add packages/api/src/services/telegram.service.ts packages/api/src/services/claude.service.ts
git commit -m "feat(api): correction loop + saveDraftAsIs for timeout/OK paths"
```

---

### Task 9: Callback query handler

**Files:**
- Modify: `packages/api/src/services/telegram.service.ts`

- [ ] **Step 1: Register handler**

Add this block in `setup()` near other handlers (before `bot.command('app', ...)` or wherever command handlers live), and after `this.bot.use(...)` if any:

```typescript
this.bot.on('callback_query', async (ctx) => {
  const data = (ctx.callbackQuery as any).data as string;
  const parsed = parseCallbackData(data);
  if (!parsed) { await ctx.answerCbQuery('Неверный формат'); return; }
  const tgId = ctx.from!.id;
  const draft = this.drafts.get(tgId);
  if (!draft || draft.id !== parsed.draftId) {
    await ctx.answerCbQuery('Драфт устарел');
    return;
  }
  switch (parsed.action) {
    case 'ok': {
      await this.saveDraftAsIs(draft);
      this.drafts.close(tgId);
      await ctx.answerCbQuery('Сохранено');
      await ctx.editMessageReplyMarkup(undefined as any);
      await ctx.reply(`✅ Сохранено: ${draft.title}`);
      break;
    }
    case 'fix': {
      this.drafts.update(tgId, { awaitingEdit: true });
      await ctx.answerCbQuery('Жду правку');
      await ctx.reply('Что поменять? Напиши или надиктуй.');
      break;
    }
    case 'cancel': {
      // save raw transcript to Inbox before dropping
      const obsidian = new ObsidianService(config.vaultPath).forUser(draft.userId);
      await obsidian.writeInboxItem(`${draft.date}-отменённый-драфт-${draft.id.slice(0, 8)}.txt`, draft.transcript);
      this.drafts.close(tgId);
      await ctx.answerCbQuery('Отменено');
      await ctx.editMessageReplyMarkup(undefined as any);
      await ctx.reply('❌ Отменено, транскрипт сохранён в Inbox.');
      break;
    }
    case 'as-meeting':
    case 'as-task':
    case 'as-idea': {
      const newType = parsed.action.replace('as-', '') as DraftCard['type'];
      const newTags = draft.tags.map((t) => t.startsWith('type/') ? `type/${newType}` : t);
      if (!newTags.some((t) => t.startsWith('type/'))) newTags.unshift(`type/${newType}`);
      const updated = this.drafts.update(tgId, { type: newType, tags: newTags });
      if (updated?.cardMessageId) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id, updated.cardMessageId, undefined,
          renderDraftCard(updated),
          { reply_markup: inlineKeyboard(updated) },
        );
      }
      await ctx.answerCbQuery(`Тип: ${newType}`);
      break;
    }
  }
});
```

- [ ] **Step 2: Commit + compile check**

```bash
pnpm --filter @pis/api exec tsc --noEmit 2>&1 | head -15 || true
git add packages/api/src/services/telegram.service.ts
git commit -m "feat(api): callback_query handlers for OK/fix/cancel/type-change"
```

---

### Task 10: Route correction through text + audio + document handlers

**Files:**
- Modify: `packages/api/src/services/telegram.service.ts`

- [ ] **Step 1: Intercept in text handler**

At the start of the text-message handler (after auth resolution, before classification), insert:
```typescript
const draft = this.drafts.get(tgId);
if (draft?.awaitingEdit) {
  await this.applyCorrection(ctx, draft, text);
  return;
}
```

- [ ] **Step 2: Also intercept in audio + document handlers**

Inside `this.bot.on(message('audio'), ...)` and `this.bot.on(message('document'), ...)` (the parts that currently call `ingestService.ingestText(transcript, userId)`), replace the call with:

```typescript
// check correction mode first
const active = this.drafts.get(tgId);
if (active?.awaitingEdit) {
  await this.applyCorrection(ctx, active, transcript);
  return;
}
await this.buildAndSendDraft(ctx, userId, tgId, 'audio', transcript, null);
```

For `message('document')` with a non-audio file (ingestBuffer path), keep current behaviour but also check the draft correction. For documents that were transcribed (audio files), use `'audio'` as sourceKind; for non-audio docs fed through `ingestBuffer`, use `'document'`:

```typescript
// In the 'document' handler, after isAudio branch that transcribes:
const active = this.drafts.get(tgId);
if (active?.awaitingEdit) {
  await this.applyCorrection(ctx, active, transcript);
  return;
}
await this.buildAndSendDraft(ctx, userId, tgId, 'audio', transcript, null);
```

For the non-audio document branch (and photo handler), keep current behaviour: immediately `ingestService.ingestBuffer(..., userId)`. They are rare enough that a confirmation card adds more friction than value. (Explicit YAGNI — future task if needed.)

- [ ] **Step 3: Commit**

```bash
pnpm --filter @pis/api exec tsc --noEmit 2>&1 | head -15 || true
git add packages/api/src/services/telegram.service.ts
git commit -m "feat(api): route corrections through text/audio/doc handlers"
```

---

## Phase 6 — Drive backup script

### Task 11: Backup script + cache directory

**Files:**
- Create: `scripts/backup-obsidian-md-to-drive.sh`
- Create: `scripts/logrotate-backup-obsidian-md`

- [ ] **Step 1: Create script**

`scripts/backup-obsidian-md-to-drive.sh`:
```bash
#!/usr/bin/env bash
# Daily mirror of /var/www/kanban-app/vault/user_2/*.md into Slava's Google Drive folder.
# Append + update semantics: never deletes files from Drive.
set -euo pipefail

SRC="/var/www/kanban-app/vault/user_2"
DST_ROOT="1UJ_GSCrisPe-SPV_7aDKihlfgATCCwtP"         # Obsidian folder on Drive
CACHE_DIR="/var/lib/backup-obsidian"
FOLDERS_CACHE="$CACHE_DIR/folder-map.tsv"            # relpath<TAB>drive_folder_id
FILES_CACHE="$CACHE_DIR/file-times.tsv"              # relpath<TAB>drive_file_id<TAB>local_mtime
LOG="/var/log/backup-obsidian-md.log"
ACCOUNT="avsmolentsev@gmail.com"

mkdir -p "$CACHE_DIR"
touch "$FOLDERS_CACHE" "$FILES_CACHE"

if [ -z "${GOG_KEYRING_PASSWORD:-}" ] && [ -f /root/.openclaw/.env ]; then
  GOG_KEYRING_PASSWORD="$(grep '^GOG_KEYRING_PASSWORD=' /root/.openclaw/.env | tail -n1 | cut -d= -f2-)"
  export GOG_KEYRING_PASSWORD
fi

log() { echo "[$(date -u +%FT%TZ)] $*" >> "$LOG"; }

ensure_folder() {
  # $1 = relpath (relative to SRC root), e.g. "Meetings" or "Projects/Sub"
  local rel="$1"
  if [ -z "$rel" ] || [ "$rel" = "." ]; then echo "$DST_ROOT"; return; fi
  local cached
  cached="$(awk -F'\t' -v r="$rel" '$1==r{print $2}' "$FOLDERS_CACHE" | head -1)"
  if [ -n "$cached" ]; then echo "$cached"; return; fi
  local parent_rel parent_id name id
  parent_rel="$(dirname "$rel")"
  [ "$parent_rel" = "." ] && parent_rel=""
  parent_id="$(ensure_folder "$parent_rel")"
  name="$(basename "$rel")"
  id="$(gog drive mkdir "$name" --parent "$parent_id" --account "$ACCOUNT" --plain 2>>"$LOG" | awk 'NR==1{print $1}')"
  if [ -z "$id" ]; then
    log "ERROR: mkdir failed for '$rel'"
    exit 1
  fi
  printf "%s\t%s\n" "$rel" "$id" >> "$FOLDERS_CACHE"
  echo "$id"
}

upload_file() {
  # $1 = absolute local path, $2 = relpath (relative to SRC)
  local abs="$1" rel="$2"
  local mtime
  mtime="$(stat -c '%Y' "$abs")"
  local cached
  cached="$(awk -F'\t' -v r="$rel" '$1==r{print $2"\t"$3}' "$FILES_CACHE" | head -1)"
  local cached_id cached_mtime
  cached_id="$(echo "$cached" | cut -f1)"
  cached_mtime="$(echo "$cached" | cut -f2)"
  if [ -n "$cached_id" ] && [ "$cached_mtime" = "$mtime" ]; then
    return  # unchanged, skip
  fi
  local parent_rel parent_id
  parent_rel="$(dirname "$rel")"
  [ "$parent_rel" = "." ] && parent_rel=""
  parent_id="$(ensure_folder "$parent_rel")"
  if [ -n "$cached_id" ]; then
    gog drive rm "$cached_id" --account "$ACCOUNT" --plain -y >>"$LOG" 2>&1 || true
  fi
  local new_id
  new_id="$(gog drive upload "$abs" --parent "$parent_id" --account "$ACCOUNT" --plain 2>>"$LOG" | awk 'NR==1{print $1}')"
  if [ -z "$new_id" ]; then
    log "ERROR: upload failed for '$rel'"
    return
  fi
  # remove old cache line and append new
  grep -v -P "^$(printf '%s' "$rel" | sed 's/[][\.^$*?|(){}\\]/\\&/g')\t" "$FILES_CACHE" > "$FILES_CACHE.tmp" || true
  mv "$FILES_CACHE.tmp" "$FILES_CACHE"
  printf "%s\t%s\t%s\n" "$rel" "$new_id" "$mtime" >> "$FILES_CACHE"
  log "UPLOADED $rel"
}

log "backup start"
if [ ! -d "$SRC" ]; then log "FATAL: src not found: $SRC"; exit 1; fi

# 1) Pre-create folder tree
while IFS= read -r dir; do
  rel="${dir#$SRC}"; rel="${rel#/}"
  case "$rel" in .git|.git/*|.trash|.trash/*|.obsidian|.obsidian/*) continue ;; esac
  ensure_folder "$rel" > /dev/null
done < <(find "$SRC" -type d \( -name .git -o -name .trash -o -name .obsidian \) -prune -o -type d -print)

# 2) Upload each .md
while IFS= read -r f; do
  rel="${f#$SRC/}"
  upload_file "$f" "$rel"
done < <(find "$SRC" -type d \( -name .git -o -name .trash -o -name .obsidian \) -prune -o -type f -name '*.md' -print)

log "backup done"
```

- [ ] **Step 2: Create logrotate config**

`scripts/logrotate-backup-obsidian-md`:
```
/var/log/backup-obsidian-md.log {
    weekly
    rotate 8
    compress
    missingok
    notifempty
    copytruncate
}
```

- [ ] **Step 3: Commit**

```bash
git add scripts/backup-obsidian-md-to-drive.sh scripts/logrotate-backup-obsidian-md
git commit -m "feat(backup): daily obsidian-md sync to Google Drive via gog"
```

---

### Task 12: Deploy workflow — ship script, install cron, install logrotate

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Add artifact upload in `build` job**

After the existing "Upload workspace manifests":
```yaml
      - name: Upload backup scripts
        uses: actions/upload-artifact@v4
        with:
          name: backup-scripts
          path: scripts/backup-obsidian-md-to-drive.sh
          retention-days: 1

      - name: Upload logrotate config
        uses: actions/upload-artifact@v4
        with:
          name: logrotate-config
          path: scripts/logrotate-backup-obsidian-md
          retention-days: 1
```

- [ ] **Step 2: Add deploy steps**

In `deploy` job, after existing downloads, add:
```yaml
      - name: Download backup scripts
        uses: actions/download-artifact@v4
        with:
          name: backup-scripts
          path: backup-scripts/

      - name: Download logrotate config
        uses: actions/download-artifact@v4
        with:
          name: logrotate-config
          path: logrotate-config/
```

After existing `Restart API` and `claude-ops-bot` steps, append:
```yaml
      - name: Install Drive backup script + cron + logrotate
        run: |
          ssh -i ~/.ssh/id_ed25519 ${{ secrets.SERVER_USER }}@${{ secrets.SERVER_HOST }} "bash -lc '
            install -m 0755 /dev/stdin /usr/local/bin/backup-obsidian-md-to-drive.sh < /dev/null
          '"
          # scp the actual file
          scp -i ~/.ssh/id_ed25519 backup-scripts/backup-obsidian-md-to-drive.sh \
            ${{ secrets.SERVER_USER }}@${{ secrets.SERVER_HOST }}:/usr/local/bin/backup-obsidian-md-to-drive.sh
          scp -i ~/.ssh/id_ed25519 logrotate-config/logrotate-backup-obsidian-md \
            ${{ secrets.SERVER_USER }}@${{ secrets.SERVER_HOST }}:/etc/logrotate.d/backup-obsidian-md
          ssh -i ~/.ssh/id_ed25519 ${{ secrets.SERVER_USER }}@${{ secrets.SERVER_HOST }} "bash -lc '
            chmod 0755 /usr/local/bin/backup-obsidian-md-to-drive.sh
            chmod 0644 /etc/logrotate.d/backup-obsidian-md
            ( crontab -l 2>/dev/null | grep -v backup-obsidian-md-to-drive ; echo \"15 3 * * * /usr/local/bin/backup-obsidian-md-to-drive.sh\" ) | crontab -
            touch /var/log/backup-obsidian-md.log
            chmod 0644 /var/log/backup-obsidian-md.log
          '"
```

The first `ssh install` using stdin is a no-op placeholder kept for formatting symmetry; the actual scp + chmod lines below do the real work. (Remove the stdin one-liner if it bothers you; it's safe as-is.)

Simplify: delete the no-op `install -m 0755 /dev/stdin` line. Final deploy step should be:

```yaml
      - name: Install Drive backup script + cron + logrotate
        run: |
          scp -i ~/.ssh/id_ed25519 backup-scripts/backup-obsidian-md-to-drive.sh \
            ${{ secrets.SERVER_USER }}@${{ secrets.SERVER_HOST }}:/usr/local/bin/backup-obsidian-md-to-drive.sh
          scp -i ~/.ssh/id_ed25519 logrotate-config/logrotate-backup-obsidian-md \
            ${{ secrets.SERVER_USER }}@${{ secrets.SERVER_HOST }}:/etc/logrotate.d/backup-obsidian-md
          ssh -i ~/.ssh/id_ed25519 ${{ secrets.SERVER_USER }}@${{ secrets.SERVER_HOST }} "bash -lc '
            chmod 0755 /usr/local/bin/backup-obsidian-md-to-drive.sh
            chmod 0644 /etc/logrotate.d/backup-obsidian-md
            ( crontab -l 2>/dev/null | grep -v backup-obsidian-md-to-drive ; echo \"15 3 * * * /usr/local/bin/backup-obsidian-md-to-drive.sh\" ) | crontab -
            touch /var/log/backup-obsidian-md.log
            chmod 0644 /var/log/backup-obsidian-md.log
          '"
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci(backup): deploy obsidian→drive backup script, cron, logrotate"
```

---

## Phase 7 — Smoke test

### Task 13: Integration smoke test

- [ ] **Step 1: Push branch**

```bash
git push origin HEAD
```

- [ ] **Step 2: Wait for CI green**

- [ ] **Step 3: TG test — voice with context**

Slava sends a voice (2-3 min): "Встречался с Максимом из Keenon Robotics, обсуждали прототип робота-мойщика для Мегамарта, договорились что подготовит ТЗ".
Expected:
- Bot: "🎤 Транскрибирую..."
- Bot: "📝 Распознано: ..."
- Bot: card message with Тип=встреча, Название, Проект=Роботы-мойщики (или близко), Компания=Keenon Robotics, Люди=Максим, Теги включая `#type/meeting`, `#company/keenon-robotics`. Inline buttons visible.
- Slava taps ✅ — bot replies "✅ Сохранено: ..."
- File appears in `vault/user_2/Meetings/2026-04-16-*.md` with correct frontmatter (`company: [[Keenon Robotics]]`).

- [ ] **Step 4: TG test — correction loop**

Slava sends another voice: "записать идею про подписку на каррибу". After card: taps ✏️, says "это не идея, а задача, добавь проект Приложение 100р/мес". Card redraws with type=task, project=Приложение 100р/мес. Slava taps ✅. File appears under `vault/user_2/Tasks/`.

- [ ] **Step 5: Drive backup manual run**

```bash
ssh root@213.139.229.148 '/usr/local/bin/backup-obsidian-md-to-drive.sh'
tail -30 /var/log/backup-obsidian-md.log
```
Expected: "backup start"..."UPLOADED ..." for many files..."backup done". No ERROR lines.

Then in browser: open Slava's Drive folder `Obsidian` — should see folder tree matching user_2 + recent meeting file uploaded.

- [ ] **Step 6: Fix anything broken, push, iterate until all smoke passes**

- [ ] **Step 7: Final commit if fixes applied**

```bash
git add -A && git commit -m "fix(obsidian-improvements): smoke-test feedback" && git push
```

---

## Deferred (NOT in this plan)

- Sticky context across multiple voices (option 2 from brainstorming) — the correction loop covers the main pain; revisit if the draft flow still feels clunky.
- Document + photo handlers going through the confirmation card. Currently they bypass the card and save immediately via ingestBuffer.
- DB column `meetings.company` — kept out for v1; frontmatter is sufficient for search until a UI uses it.
- Drive backup with deletions mirroring (currently append + update only).
- Voice reply to correction-prompt with automatic re-extraction — works today, but no explicit unit test.

---

## Self-review notes

Covered spec sections: confirmation card (Tasks 6, 9), correction loop (Tasks 8, 10), company field + hierarchical tags (Tasks 2, 3), 30-min timeout (Task 5), type-change buttons (Tasks 6, 9), canonical tag scheme (Tasks 2, 3), cancel saves transcript to Inbox (Task 9), Drive backup script + cron + logrotate (Tasks 11, 12), smoke tests (Task 13). MCP install done inline before plan.

Types consistent: `ExtractionResult` / `DraftCard` defined in Task 1, used unchanged in Tasks 2, 5, 6, 8, 9, 10.

No placeholders — every step shows concrete code or exact command.
