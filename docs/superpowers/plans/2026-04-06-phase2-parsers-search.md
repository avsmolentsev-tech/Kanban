# Phase 2: Parsers + Full-text Search — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add docx/image/audio/URL parsers to the ingestion pipeline and full-text search across all data.

**Architecture:** Each parser is a standalone module in `packages/api/src/parsers/` following the existing pattern (async function taking Buffer, returning string). Search uses SQLite FTS5 with a service layer for indexing and querying. Frontend gets a live search bar in the app header.

**Tech Stack:** mammoth, OpenAI SDK (gpt-4o vision, whisper-1), cheerio, SQLite FTS5, fs.watch

---

## Task 1: Docx Parser

**Files to create/modify:**
- CREATE `packages/api/src/parsers/docx.parser.ts`
- MODIFY `packages/api/src/parsers/index.ts`

**Step 1 — verify mammoth is already installed:**
```bash
cd packages/api && cat package.json | grep mammoth
```
If missing: `pnpm add mammoth && pnpm add -D @types/mammoth`

**Step 2 — create `packages/api/src/parsers/docx.parser.ts`:**
```typescript
import mammoth from 'mammoth';

export async function parseDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  if (result.messages.length > 0) {
    const warnings = result.messages.filter((m) => m.type === 'warning');
    if (warnings.length > 0) {
      console.warn('[docx.parser] warnings:', warnings.map((m) => m.message).join(', '));
    }
  }
  return result.value.trim();
}
```

**Step 3 — update `packages/api/src/parsers/index.ts`** (add import and case):
```typescript
import { parseTxt } from './txt.parser';
import { parsePdf } from './pdf.parser';
import { parseDocx } from './docx.parser';
import type { IngestFileType } from '@pis/shared';

export async function parseFile(buffer: Buffer, fileType: IngestFileType): Promise<string> {
  switch (fileType) {
    case 'txt':
    case 'md':
      return parseTxt(buffer);
    case 'pdf':
      return parsePdf(buffer);
    case 'docx':
      return parseDocx(buffer);
    default:
      throw new Error(`Unsupported file type in Phase 2: ${fileType}`);
  }
}

export function detectFileType(filename: string): IngestFileType {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, IngestFileType> = {
    txt: 'txt', md: 'md', pdf: 'pdf', docx: 'docx',
    png: 'png', jpg: 'jpg', jpeg: 'jpeg',
    mp3: 'mp3', wav: 'wav', m4a: 'm4a', ogg: 'ogg',
  };
  return map[ext] ?? 'txt';
}
```

**Step 4 — test:**
```typescript
// packages/api/src/parsers/__tests__/docx.parser.test.ts
import { parseDocx } from '../docx.parser';
import * as fs from 'fs';
import * as path from 'path';

// Create a minimal test: use a real .docx buffer from fixtures, or mock mammoth
jest.mock('mammoth', () => ({
  extractRawText: jest.fn().mockResolvedValue({ value: 'Hello from docx', messages: [] }),
}));

describe('parseDocx', () => {
  it('returns extracted text from buffer', async () => {
    const result = await parseDocx(Buffer.from('fake-docx-binary'));
    expect(result).toBe('Hello from docx');
  });

  it('trims leading/trailing whitespace', async () => {
    const mammoth = require('mammoth');
    mammoth.extractRawText.mockResolvedValueOnce({ value: '  padded text  ', messages: [] });
    const result = await parseDocx(Buffer.from(''));
    expect(result).toBe('padded text');
  });
});
```

**Step 5 — commit:**
```bash
cd "C:/Users/smolentsev/.claude/NewProject/Kanban" && git add packages/api/src/parsers/docx.parser.ts packages/api/src/parsers/index.ts && git commit -m "feat(parsers): add docx parser via mammoth"
```

---

## Task 2: Image Parser

**Files to create/modify:**
- CREATE `packages/api/src/parsers/image.parser.ts`
- MODIFY `packages/api/src/parsers/index.ts`
- MODIFY `apps/web/src/components/upload/FileIngestion.tsx`

**Step 1 — create `packages/api/src/parsers/image.parser.ts`:**
```typescript
import OpenAI from 'openai';
import { config } from '../config';

const SUPPORTED_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

export async function parseImage(buffer: Buffer, ext = 'png'): Promise<string> {
  const client = new OpenAI({ apiKey: config.openaiApiKey });
  const mimeType = SUPPORTED_MIME[ext] ?? 'image/png';
  const base64 = buffer.toString('base64');
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: dataUrl, detail: 'high' },
          },
          {
            type: 'text',
            text: 'Describe all text and meaningful content in this image. Extract any text verbatim. Describe diagrams, charts, or visual information in detail.',
          },
        ],
      },
    ],
  });

  return response.choices[0]?.message?.content?.trim() ?? '';
}
```

**Step 2 — update `packages/api/src/parsers/index.ts`** (add import and cases):
```typescript
import { parseTxt } from './txt.parser';
import { parsePdf } from './pdf.parser';
import { parseDocx } from './docx.parser';
import { parseImage } from './image.parser';
import type { IngestFileType } from '@pis/shared';

export async function parseFile(buffer: Buffer, fileType: IngestFileType): Promise<string> {
  switch (fileType) {
    case 'txt':
    case 'md':
      return parseTxt(buffer);
    case 'pdf':
      return parsePdf(buffer);
    case 'docx':
      return parseDocx(buffer);
    case 'png':
      return parseImage(buffer, 'png');
    case 'jpg':
    case 'jpeg':
      return parseImage(buffer, 'jpg');
    default:
      throw new Error(`Unsupported file type in Phase 2: ${fileType}`);
  }
}
// detectFileType stays the same
```

**Step 3 — update `apps/web/src/components/upload/FileIngestion.tsx`**, change the accept attribute on the hidden file input:
```tsx
// Before:
<input ref={fileRef} type="file" className="hidden" accept=".txt,.md,.pdf" onChange={...} />

// After:
<input
  ref={fileRef}
  type="file"
  className="hidden"
  accept=".txt,.md,.pdf,.docx,.png,.jpg,.jpeg"
  onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); }}
/>
```

Also update the helper text inside the drop zone (find the text like "TXT, MD, PDF" and extend it):
```tsx
// Find and update any label text, e.g.:
<p className="text-sm text-gray-500">TXT, MD, PDF, DOCX, PNG, JPG</p>
```

**Step 4 — test:**
```typescript
// packages/api/src/parsers/__tests__/image.parser.test.ts
import { parseImage } from '../image.parser';

jest.mock('openai', () => {
  return {
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: 'A screenshot showing a dashboard' } }],
          }),
        },
      },
    })),
  };
});

describe('parseImage', () => {
  it('sends base64 image to gpt-4o and returns description', async () => {
    const result = await parseImage(Buffer.from('fake-png'), 'png');
    expect(result).toBe('A screenshot showing a dashboard');
  });

  it('uses image/jpeg mime type for jpg extension', async () => {
    const OpenAI = require('openai').default;
    const instance = new OpenAI();
    await parseImage(Buffer.from(''), 'jpg');
    const call = instance.chat.completions.create.mock.calls[0][0];
    const imgContent = call.messages[0].content[0];
    expect(imgContent.image_url.url).toContain('data:image/jpeg;base64,');
  });
});
```

**Step 5 — commit:**
```bash
cd "C:/Users/smolentsev/.claude/NewProject/Kanban" && git add packages/api/src/parsers/image.parser.ts packages/api/src/parsers/index.ts apps/web/src/components/upload/FileIngestion.tsx && git commit -m "feat(parsers): add image parser via OpenAI gpt-4o vision"
```

---

## Task 3: Audio Parser

**Files to create/modify:**
- CREATE `packages/api/src/parsers/audio.parser.ts`
- MODIFY `packages/api/src/parsers/index.ts`
- MODIFY `apps/web/src/components/upload/FileIngestion.tsx`

**Step 1 — create `packages/api/src/parsers/audio.parser.ts`:**
```typescript
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { config } from '../config';

const MIME_MAP: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
};

export async function parseAudio(buffer: Buffer, ext = 'mp3'): Promise<string> {
  const client = new OpenAI({ apiKey: config.openaiApiKey });

  // Whisper API requires a real file — write buffer to temp file
  const tmpFile = path.join(os.tmpdir(), `pis-audio-${Date.now()}.${ext}`);
  fs.writeFileSync(tmpFile, buffer);

  try {
    const transcription = await client.audio.transcriptions.create({
      model: 'whisper-1',
      file: fs.createReadStream(tmpFile) as unknown as File,
      response_format: 'text',
    });
    return typeof transcription === 'string' ? transcription.trim() : '';
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore cleanup errors */ }
  }
}
```

**Step 2 — update `packages/api/src/parsers/index.ts`** (add import and cases):
```typescript
import { parseTxt } from './txt.parser';
import { parsePdf } from './pdf.parser';
import { parseDocx } from './docx.parser';
import { parseImage } from './image.parser';
import { parseAudio } from './audio.parser';
import type { IngestFileType } from '@pis/shared';

export async function parseFile(buffer: Buffer, fileType: IngestFileType): Promise<string> {
  switch (fileType) {
    case 'txt':
    case 'md':
      return parseTxt(buffer);
    case 'pdf':
      return parsePdf(buffer);
    case 'docx':
      return parseDocx(buffer);
    case 'png':
      return parseImage(buffer, 'png');
    case 'jpg':
    case 'jpeg':
      return parseImage(buffer, 'jpg');
    case 'mp3':
      return parseAudio(buffer, 'mp3');
    case 'wav':
      return parseAudio(buffer, 'wav');
    case 'm4a':
      return parseAudio(buffer, 'm4a');
    case 'ogg':
      return parseAudio(buffer, 'ogg');
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}
// detectFileType stays the same
```

**Step 3 — update `apps/web/src/components/upload/FileIngestion.tsx`**, extend accept attribute:
```tsx
<input
  ref={fileRef}
  type="file"
  className="hidden"
  accept=".txt,.md,.pdf,.docx,.png,.jpg,.jpeg,.mp3,.wav,.m4a,.ogg"
  onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); }}
/>
```

Update drop zone label text:
```tsx
<p className="text-sm text-gray-500">TXT, MD, PDF, DOCX, PNG, JPG, MP3, WAV, M4A, OGG</p>
```

**Step 4 — test:**
```typescript
// packages/api/src/parsers/__tests__/audio.parser.test.ts
import { parseAudio } from '../audio.parser';
import * as fs from 'fs';

jest.mock('openai', () => {
  return {
    default: jest.fn().mockImplementation(() => ({
      audio: {
        transcriptions: {
          create: jest.fn().mockResolvedValue('Hello this is a transcription'),
        },
      },
    })),
  };
});

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  writeFileSync: jest.fn(),
  createReadStream: jest.fn().mockReturnValue({ pipe: jest.fn() }),
  unlinkSync: jest.fn(),
}));

describe('parseAudio', () => {
  it('transcribes audio buffer via Whisper and returns trimmed text', async () => {
    const result = await parseAudio(Buffer.from('fake-audio'), 'mp3');
    expect(result).toBe('Hello this is a transcription');
  });

  it('cleans up temp file even on success', async () => {
    await parseAudio(Buffer.from(''), 'wav');
    expect(fs.unlinkSync).toHaveBeenCalled();
  });
});
```

**Step 5 — commit:**
```bash
cd "C:/Users/smolentsev/.claude/NewProject/Kanban" && git add packages/api/src/parsers/audio.parser.ts packages/api/src/parsers/index.ts apps/web/src/components/upload/FileIngestion.tsx && git commit -m "feat(parsers): add audio parser via OpenAI Whisper"
```

---

## Task 4: URL Parser

**Files to create/modify:**
- CREATE `packages/api/src/parsers/url.parser.ts`
- MODIFY `packages/api/src/parsers/index.ts`
- MODIFY `apps/web/src/components/upload/FileIngestion.tsx`
- MODIFY `packages/api/src/routes/ingest.ts`

**Step 1 — install cheerio:**
```bash
cd packages/api && pnpm add cheerio
```

**Step 2 — create `packages/api/src/parsers/url.parser.ts`:**
```typescript
import * as cheerio from 'cheerio';
import OpenAI from 'openai';
import { config } from '../config';

const MIN_TEXT_LENGTH = 100;

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PIS-bot/1.0)' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

function extractWithCheerio(html: string): { title: string; text: string } {
  const $ = cheerio.load(html);

  // Remove noise elements
  $('script, style, nav, footer, header, aside, [role="navigation"], .cookie-banner, .ad').remove();

  const title = $('title').first().text().trim()
    || $('h1').first().text().trim()
    || 'Untitled';

  // Prefer article/main content areas
  const contentEl = $('article, main, [role="main"], .content, .post-content, #content').first();
  const text = (contentEl.length ? contentEl : $('body')).text()
    .replace(/\s+/g, ' ')
    .trim();

  return { title, text };
}

async function extractWithOpenAI(html: string, url: string): Promise<string> {
  const client = new OpenAI({ apiKey: config.openaiApiKey });

  // Truncate HTML to avoid token limits
  const truncatedHtml = html.slice(0, 30_000);

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `Extract the main textual content from this webpage HTML. Return only the meaningful text content (title, main article text, key information). URL: ${url}\n\nHTML:\n${truncatedHtml}`,
      },
    ],
  });

  return response.choices[0]?.message?.content?.trim() ?? '';
}

export async function parseUrl(url: string): Promise<string> {
  const html = await fetchHtml(url);
  const { title, text } = extractWithCheerio(html);

  if (text.length >= MIN_TEXT_LENGTH) {
    return `# ${title}\n\nSource: ${url}\n\n${text}`;
  }

  // Fallback: OpenAI parses the raw HTML
  console.warn(`[url.parser] cheerio extracted only ${text.length} chars, falling back to OpenAI`);
  const aiText = await extractWithOpenAI(html, url);
  return `# ${title}\n\nSource: ${url}\n\n${aiText}`;
}
```

**Step 3 — update `packages/api/src/parsers/index.ts`** — URL is not a file type with a buffer, so it is handled separately. Add a named export for direct use:
```typescript
// Add to the bottom of index.ts:
export { parseUrl } from './url.parser';
```

The `parseFile` switch does NOT need a 'url' case — URL ingestion is a separate flow handled in the route.

**Step 4 — update `packages/api/src/routes/ingest.ts`** — add URL ingestion branch:
```typescript
import { parseUrl } from '../parsers';
// ... existing imports ...

ingestRouter.post('/', upload.single('file'), async (req: Request, res: Response) => {
  try {
    let result;
    if (req.file) {
      result = await ingestService.ingestBuffer(req.file.buffer, req.file.originalname);
    } else if (typeof req.body['text'] === 'string') {
      result = await ingestService.ingestText(req.body['text'] as string);
    } else if (typeof req.body['url'] === 'string') {
      // NEW: URL ingestion
      const url = req.body['url'] as string;
      const extractedText = await parseUrl(url);
      const urlFilename = `url-${Date.now()}.md`;
      result = await ingestService.ingestText(extractedText, urlFilename);
    } else {
      res.status(400).json(fail('Provide a file, text, or url field'));
      return;
    }

    // project_id association (existing code, unchanged)
    const projectId = req.body['project_id'] ? Number(req.body['project_id']) : null;
    if (projectId) {
      const db = getDb();
      for (const record of result.created_records) {
        if (record.type === 'meeting') {
          db.prepare('UPDATE meetings SET project_id = ? WHERE id = ?').run(projectId, record.id);
        } else if (record.type === 'task') {
          db.prepare('UPDATE tasks SET project_id = ? WHERE id = ?').run(projectId, record.id);
        }
      }
    }

    res.status(201).json(ok(result));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Ingest failed'));
  }
});
```

Note: `ingestService.ingestText` already exists; check its signature — if it only takes `text: string`, add an optional second param `filename?: string` to `ingest.service.ts` for better labeling.

**Step 5 — update `apps/web/src/components/upload/FileIngestion.tsx`** — add URL input field:

Add `url` state and `processUrl` handler alongside existing state:
```tsx
const [url, setUrl] = useState('');

const processUrl = async () => {
  if (!url.trim()) return;
  setLoading(true); setError(null); setResult(null);
  try {
    const r = await ingestApi.ingestUrl(url.trim(), selectedProjectId ?? undefined);
    setResult(r); setUrl(''); onComplete?.(r);
  } catch (e) { setError(e instanceof Error ? e.message : 'URL ingest failed'); }
  finally { setLoading(false); }
};
```

Add URL input section in the JSX (after the text area section, before the results):
```tsx
{/* URL ingestion */}
<div>
  <label className="block text-xs font-medium text-gray-500 mb-1">Ingest from URL</label>
  <div className="flex gap-2">
    <input
      type="url"
      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-300"
      placeholder="https://example.com/article"
      value={url}
      onChange={(e) => setUrl(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') processUrl(); }}
      disabled={loading}
    />
    <button
      onClick={processUrl}
      disabled={loading || !url.trim()}
      className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50"
    >
      Fetch
    </button>
  </div>
</div>
```

**Step 6 — update `apps/web/src/api/ingest.api.ts`** — add `ingestUrl`:
```typescript
ingestUrl: async (url: string, projectId?: number): Promise<IngestResult> => {
  const res = await apiClient.post<ApiResponse<IngestResult>>('/ingest', {
    url,
    project_id: projectId,
  });
  if (!res.data.success || !res.data.data) throw new Error(res.data.error ?? 'URL ingest failed');
  return res.data.data;
},
```

**Step 7 — test:**
```typescript
// packages/api/src/parsers/__tests__/url.parser.test.ts
import { parseUrl } from '../url.parser';

global.fetch = jest.fn();

describe('parseUrl', () => {
  it('extracts title and text using cheerio when content is sufficient', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () => `<html><head><title>Test Article</title></head><body><article>${'word '.repeat(50)}</article></body></html>`,
    });

    const result = await parseUrl('https://example.com/article');
    expect(result).toContain('# Test Article');
    expect(result).toContain('Source: https://example.com/article');
  });

  it('falls back to OpenAI when cheerio text is too short', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () => '<html><body><p>Short</p></body></html>',
    });

    const openai = require('openai').default;
    // OpenAI mock should already return content from prior setup
    const result = await parseUrl('https://example.com/sparse');
    expect(result).toBeDefined();
  });

  it('throws on HTTP error', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 404 });
    await expect(parseUrl('https://example.com/404')).rejects.toThrow('HTTP 404');
  });
});
```

**Step 8 — commit:**
```bash
cd "C:/Users/smolentsev/.claude/NewProject/Kanban" && git add packages/api/src/parsers/url.parser.ts packages/api/src/parsers/index.ts packages/api/src/routes/ingest.ts apps/web/src/components/upload/FileIngestion.tsx apps/web/src/api/ingest.api.ts && git commit -m "feat(parsers): add URL parser with cheerio + OpenAI fallback"
```

---

## Task 5: Search Service + FTS5

**Files to create/modify:**
- MODIFY `packages/api/src/db/db.ts`
- CREATE `packages/api/src/services/search.service.ts`

**Step 1 — add FTS5 table to `packages/api/src/db/db.ts`** — add migration after existing migrations in `initDb()` and `initTestDb()`:
```typescript
// Add FTS5 virtual table for full-text search
try {
  _db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
      type,
      ref_id UNINDEXED,
      title,
      body,
      tokenize = 'unicode61'
    )
  `);
} catch (e) {
  console.warn('[db] FTS5 search_index already exists or not supported:', e);
}
```

**Step 2 — create `packages/api/src/services/search.service.ts`:**
```typescript
import { getDb } from '../db/db';

export interface SearchResultItem {
  type: string;
  ref_id: number;
  title: string;
  snippet: string;
  rank: number;
}

export class SearchService {
  indexRecord(type: string, refId: number, title: string, body: string): void {
    const db = getDb();
    // Remove old entry for this record first (upsert via delete + insert)
    db.prepare(
      "DELETE FROM search_index WHERE type = ? AND ref_id = ?"
    ).run(type, refId);

    db.prepare(
      "INSERT INTO search_index (type, ref_id, title, body) VALUES (?, ?, ?, ?)"
    ).run(type, refId, title, body);
  }

  removeRecord(type: string, refId: number): void {
    const db = getDb();
    db.prepare("DELETE FROM search_index WHERE type = ? AND ref_id = ?").run(type, refId);
  }

  search(query: string, limit = 20): SearchResultItem[] {
    if (!query.trim()) return [];
    const db = getDb();

    // FTS5 MATCH with snippet() for highlighted results
    // snippet(table, column_idx, start_mark, end_mark, ellipsis, num_tokens)
    const rows = db.prepare(`
      SELECT
        type,
        ref_id,
        title,
        snippet(search_index, 3, '<mark>', '</mark>', '…', 16) AS snippet,
        rank
      FROM search_index
      WHERE search_index MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(query, limit) as Array<{
      type: string;
      ref_id: number;
      title: string;
      snippet: string;
      rank: number;
    }>;

    return rows.map((r) => ({
      type: r.type,
      ref_id: r.ref_id,
      title: r.title,
      snippet: r.snippet,
      rank: r.rank,
    }));
  }

  reindexAll(): void {
    const db = getDb();

    // Clear existing index
    db.prepare("DELETE FROM search_index").run();

    // Index tasks
    const tasks = db.prepare("SELECT id, title, description FROM tasks WHERE archived = 0").all() as Array<{ id: number; title: string; description: string }>;
    const insertStmt = db.prepare("INSERT INTO search_index (type, ref_id, title, body) VALUES (?, ?, ?, ?)");
    const reindexMany = db.transaction((records: Array<{ type: string; id: number; title: string; body: string }>) => {
      for (const r of records) insertStmt.run(r.type, r.id, r.title, r.body);
    });

    reindexMany([
      ...tasks.map((r) => ({ type: 'task', id: r.id, title: r.title, body: r.description })),
    ]);

    // Index meetings
    const meetings = db.prepare("SELECT id, title, summary_raw FROM meetings").all() as Array<{ id: number; title: string; summary_raw: string }>;
    reindexMany(meetings.map((r) => ({ type: 'meeting', id: r.id, title: r.title, body: r.summary_raw ?? '' })));

    // Index ideas
    const ideas = db.prepare("SELECT id, title, body FROM ideas").all() as Array<{ id: number; title: string; body: string }>;
    reindexMany(ideas.map((r) => ({ type: 'idea', id: r.id, title: r.title, body: r.body ?? '' })));

    // Index documents
    const docs = db.prepare("SELECT id, title, content FROM documents").all() as Array<{ id: number; title: string; content: string }>;
    reindexMany(docs.map((r) => ({ type: 'document', id: r.id, title: r.title, body: r.content ?? '' })));

    // Index people
    const people = db.prepare("SELECT id, name, notes FROM people").all() as Array<{ id: number; name: string; notes: string }>;
    reindexMany(people.map((r) => ({ type: 'person', id: r.id, title: r.name, body: r.notes ?? '' })));

    console.log(`[search] reindexed ${tasks.length + meetings.length + ideas.length + docs.length + people.length} records`);
  }
}

export const searchService = new SearchService();
```

**Step 3 — test:**
```typescript
// packages/api/src/services/__tests__/search.service.test.ts
import { initTestDb } from '../../db/db';
import { SearchService } from '../search.service';

describe('SearchService', () => {
  let service: SearchService;

  beforeEach(() => {
    initTestDb();
    service = new SearchService();
  });

  it('indexes and finds a record', () => {
    service.indexRecord('task', 1, 'Buy groceries', 'Need to buy milk and eggs');
    const results = service.search('milk');
    expect(results).toHaveLength(1);
    expect(results[0]?.type).toBe('task');
    expect(results[0]?.ref_id).toBe(1);
  });

  it('returns empty array for empty query', () => {
    expect(service.search('')).toEqual([]);
    expect(service.search('   ')).toEqual([]);
  });

  it('removes a record by type and ref_id', () => {
    service.indexRecord('idea', 5, 'Build a rocket', 'SpaceX-style rocket design');
    service.removeRecord('idea', 5);
    const results = service.search('rocket');
    expect(results).toHaveLength(0);
  });

  it('upserts — re-indexing same record does not duplicate', () => {
    service.indexRecord('meeting', 1, 'Q1 Review', 'Revenue discussion');
    service.indexRecord('meeting', 1, 'Q1 Review Updated', 'Revenue and costs discussion');
    const results = service.search('discussion');
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe('Q1 Review Updated');
  });
});
```

**Step 4 — commit:**
```bash
cd "C:/Users/smolentsev/.claude/NewProject/Kanban" && git add packages/api/src/db/db.ts packages/api/src/services/search.service.ts && git commit -m "feat(search): add SearchService with FTS5 virtual table"
```

---

## Task 6: Search API + Vault Watcher

**Files to create/modify:**
- CREATE `packages/api/src/routes/search.ts`
- MODIFY `packages/api/src/routes/index.ts`
- MODIFY `packages/api/src/routes/tasks.ts` (and meetings, ideas, documents, people)
- MODIFY `packages/api/src/services/search.service.ts`
- MODIFY `packages/api/src/index.ts`

**Step 1 — create `packages/api/src/routes/search.ts`:**
```typescript
import { Router, Request, Response } from 'express';
import { searchService } from '../services/search.service';
import { ok, fail } from '@pis/shared';

export const searchRouter = Router();

// GET /v1/search?q=<query>&limit=<n>
searchRouter.get('/', (req: Request, res: Response) => {
  const q = req.query['q'];
  const limit = req.query['limit'] ? Number(req.query['limit']) : 20;

  if (typeof q !== 'string' || !q.trim()) {
    res.json(ok([]));
    return;
  }

  try {
    const results = searchService.search(q.trim(), limit);
    res.json(ok(results));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Search failed'));
  }
});

// POST /v1/search/reindex
searchRouter.post('/reindex', (_req: Request, res: Response) => {
  try {
    searchService.reindexAll();
    res.json(ok({ message: 'Reindex complete' }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Reindex failed'));
  }
});
```

**Step 2 — register in `packages/api/src/routes/index.ts`:**
```typescript
import { searchRouter } from './search';
// ... existing imports ...

router.use('/search', searchRouter);
// Add at the bottom with other router.use() calls
```

**Step 3 — add indexRecord calls in route handlers.**

In `packages/api/src/routes/tasks.ts`, after any successful INSERT or UPDATE:
```typescript
import { searchService } from '../services/search.service';

// After successful task INSERT (in the POST handler), find the newly created task and index it:
// e.g. after: const result = db.prepare('INSERT INTO tasks ...').run(...)
const newTask = db.prepare('SELECT id, title, description FROM tasks WHERE id = ?').get(Number(result.lastInsertRowid)) as { id: number; title: string; description: string };
if (newTask) searchService.indexRecord('task', newTask.id, newTask.title, newTask.description);

// After successful task PATCH (UPDATE), re-index with updated data:
const updated = db.prepare('SELECT id, title, description FROM tasks WHERE id = ?').get(id) as { id: number; title: string; description: string } | undefined;
if (updated) searchService.indexRecord('task', updated.id, updated.title, updated.description);
```

Apply the same pattern to:
- `packages/api/src/routes/meetings.ts` — type `'meeting'`, title + summary_raw
- `packages/api/src/routes/ideas.ts` — type `'idea'`, title + body
- `packages/api/src/routes/documents.ts` — type `'document'`, title + content
- `packages/api/src/routes/people.ts` — type `'person'`, name + notes

**Step 4 — add fs.watch vault watcher in `packages/api/src/services/search.service.ts`:**
```typescript
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';

// Add this method to SearchService:
startVaultWatcher(): void {
  const vaultPath = config.vaultPath;
  if (!fs.existsSync(vaultPath)) {
    console.warn(`[search] vault path not found, watcher skipped: ${vaultPath}`);
    return;
  }

  console.log(`[search] watching vault at ${vaultPath}`);

  fs.watch(vaultPath, { recursive: true }, (eventType, filename) => {
    if (!filename || !filename.endsWith('.md')) return;

    const filePath = path.join(vaultPath, filename);
    const type = 'vault';
    const title = path.basename(filename, '.md');

    if (eventType === 'rename' && !fs.existsSync(filePath)) {
      // File deleted — find and remove from index by title (best effort)
      // FTS5 doesn't support arbitrary WHERE on non-unindexed columns easily,
      // so we use a separate lookup approach
      try {
        const db = (await import('../db/db')).getDb();
        db.prepare("DELETE FROM search_index WHERE type = 'vault' AND title = ?").run(title);
      } catch { /* ignore */ }
      return;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      // Strip YAML frontmatter
      const body = content.replace(/^---[\s\S]*?---\n/, '').trim();
      // Use file modification time as a synthetic ref_id (hash the path)
      const refId = Math.abs(filename.split('').reduce((acc, c) => acc * 31 + c.charCodeAt(0), 0)) % 2_000_000_000;
      this.indexRecord(type, refId, title, body);
    } catch (err) {
      console.warn(`[search] failed to index vault file ${filename}:`, err);
    }
  });
}
```

Note: The `import('../db/db')` in the watcher callback should be replaced with a direct synchronous `getDb()` import at top of file — the dynamic import was illustrative. Use:
```typescript
import { getDb } from '../db/db';
// then inside the callback:
const db = getDb();
```

**Step 5 — call reindexAll and startVaultWatcher on startup in `packages/api/src/index.ts`:**
```typescript
import { searchService } from './services/search.service';

async function start(): Promise<void> {
  initDb();
  seedDb();

  // Full-text search: reindex existing data and start vault watcher
  try {
    searchService.reindexAll();
    searchService.startVaultWatcher();
  } catch (err) {
    console.warn('[PIS API] search init failed (non-fatal):', err);
  }

  app.listen(config.port, () => {
    console.log(`[PIS API] running on port ${config.port}`);
  });
}
```

**Step 6 — test:**
```typescript
// packages/api/src/routes/__tests__/search.test.ts
import request from 'supertest';
import express from 'express';
import { searchRouter } from '../search';
import { searchService } from '../../services/search.service';

jest.mock('../../services/search.service', () => ({
  searchService: {
    search: jest.fn().mockReturnValue([
      { type: 'task', ref_id: 1, title: 'My task', snippet: '…<mark>keyword</mark>…', rank: -1.5 },
    ]),
    reindexAll: jest.fn(),
  },
}));

const app = express();
app.use(express.json());
app.use('/search', searchRouter);

describe('GET /search', () => {
  it('returns search results for a query', async () => {
    const res = await request(app).get('/search?q=keyword');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].type).toBe('task');
  });

  it('returns empty array for blank query', async () => {
    const res = await request(app).get('/search?q=');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('POST /search/reindex', () => {
  it('triggers reindexAll and returns ok', async () => {
    const res = await request(app).post('/search/reindex');
    expect(res.status).toBe(200);
    expect(searchService.reindexAll).toHaveBeenCalled();
  });
});
```

**Step 7 — commit:**
```bash
cd "C:/Users/smolentsev/.claude/NewProject/Kanban" && git add packages/api/src/routes/search.ts packages/api/src/routes/index.ts packages/api/src/routes/tasks.ts packages/api/src/routes/meetings.ts packages/api/src/routes/ideas.ts packages/api/src/routes/documents.ts packages/api/src/routes/people.ts packages/api/src/services/search.service.ts packages/api/src/index.ts && git commit -m "feat(search): add search API routes, vault watcher, and auto-indexing on write"
```

---

## Task 7: Live Search UI

**Files to create/modify:**
- CREATE `apps/web/src/api/search.api.ts`
- CREATE `apps/web/src/components/search/SearchBar.tsx`
- MODIFY `apps/web/src/App.tsx` (or the main layout component that renders the header)

**Step 1 — create `apps/web/src/api/search.api.ts`:**
```typescript
import { apiClient } from './client';
import type { ApiResponse } from '@pis/shared';

export interface SearchResultItem {
  type: string;
  ref_id: number;
  title: string;
  snippet: string;
  rank: number;
}

export const searchApi = {
  search: async (query: string, limit = 20): Promise<SearchResultItem[]> => {
    if (!query.trim()) return [];
    const res = await apiClient.get<ApiResponse<SearchResultItem[]>>('/search', {
      params: { q: query, limit },
    });
    if (!res.data.success || !res.data.data) return [];
    return res.data.data;
  },

  reindex: async (): Promise<void> => {
    await apiClient.post('/search/reindex');
  },
};
```

**Step 2 — create `apps/web/src/components/search/SearchBar.tsx`:**
```tsx
import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchApi, type SearchResultItem } from '../../api/search.api';

const TYPE_ROUTES: Record<string, (id: number) => string> = {
  task: (id) => `/tasks?highlight=${id}`,
  meeting: (id) => `/meetings/${id}`,
  idea: (id) => `/ideas/${id}`,
  document: (id) => `/documents/${id}`,
  person: (id) => `/people/${id}`,
  vault: () => `/`,
};

const TYPE_LABELS: Record<string, string> = {
  task: 'Tasks',
  meeting: 'Meetings',
  idea: 'Ideas',
  document: 'Documents',
  person: 'People',
  vault: 'Vault',
};

function groupByType(results: SearchResultItem[]): Record<string, SearchResultItem[]> {
  return results.reduce<Record<string, SearchResultItem[]>>((acc, item) => {
    (acc[item.type] ??= []).push(item);
    return acc;
  }, {});
}

export function SearchBar() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    try {
      const data = await searchApi.search(q);
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, doSearch]);

  const handleOpen = () => {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleClose = () => {
    setOpen(false);
    setQuery('');
    setResults([]);
  };

  const handleSelect = (item: SearchResultItem) => {
    const routeFn = TYPE_ROUTES[item.type];
    if (routeFn) navigate(routeFn(item.ref_id));
    handleClose();
  };

  const grouped = groupByType(results);
  const hasResults = results.length > 0;

  return (
    <div className="relative">
      {/* Search toggle button */}
      {!open && (
        <button
          onClick={handleOpen}
          className="p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          aria-label="Search"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>
      )}

      {/* Expanded search input */}
      {open && (
        <div className="flex items-center gap-2">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              className="pl-9 pr-4 py-2 w-64 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200"
              placeholder="Search everything..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') handleClose(); }}
            />
            {loading && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>
          <button
            onClick={handleClose}
            className="p-1 text-gray-400 hover:text-gray-600"
            aria-label="Close search"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Results dropdown */}
      {open && query.trim() && (
        <div className="absolute top-full right-0 mt-1 w-96 bg-white border border-gray-200 rounded-xl shadow-lg z-50 max-h-[70vh] overflow-y-auto">
          {!hasResults && !loading && (
            <div className="px-4 py-6 text-sm text-gray-400 text-center">
              No results for "{query}"
            </div>
          )}

          {hasResults && Object.entries(grouped).map(([type, items]) => (
            <div key={type}>
              <div className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50 border-b border-gray-100">
                {TYPE_LABELS[type] ?? type}
              </div>
              {items.map((item) => (
                <button
                  key={`${item.type}-${item.ref_id}`}
                  onClick={() => handleSelect(item)}
                  className="w-full text-left px-4 py-3 hover:bg-indigo-50 border-b border-gray-50 last:border-0 transition-colors"
                >
                  <div className="text-sm font-medium text-gray-800 truncate">{item.title}</div>
                  <div
                    className="text-xs text-gray-500 mt-0.5 line-clamp-2"
                    dangerouslySetInnerHTML={{ __html: item.snippet }}
                  />
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Click-outside overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40"
          onClick={handleClose}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
```

**Step 3 — add SearchBar to `apps/web/src/App.tsx`** in the header area.

First, find where the app header/navbar is rendered. Look for the top-level layout — it may be in `App.tsx` directly or a `Layout` component. Add the import and component:

```tsx
import { SearchBar } from './components/search/SearchBar';

// Inside the header JSX, alongside existing header actions:
<header className="...existing classes...">
  <div className="flex items-center gap-2">
    {/* ... existing header content ... */}
    <SearchBar />
  </div>
</header>
```

The exact placement depends on the current header structure. SearchBar should be placed on the right side of the header nav, alongside any existing icon buttons.

**Step 4 — test:**
```typescript
// apps/web/src/components/search/__tests__/SearchBar.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SearchBar } from '../SearchBar';
import { searchApi } from '../../../api/search.api';

jest.mock('../../../api/search.api', () => ({
  searchApi: {
    search: jest.fn().mockResolvedValue([
      { type: 'task', ref_id: 1, title: 'Buy milk', snippet: 'Need to <mark>buy</mark> milk', rank: -1 },
      { type: 'idea', ref_id: 3, title: 'Rocket project', snippet: 'A <mark>project</mark> idea', rank: -0.8 },
    ]),
  },
}));

const renderBar = () => render(<MemoryRouter><SearchBar /></MemoryRouter>);

describe('SearchBar', () => {
  it('shows a search icon button initially', () => {
    renderBar();
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
  });

  it('expands to input on click', () => {
    renderBar();
    fireEvent.click(screen.getByLabelText('Search'));
    expect(screen.getByPlaceholderText('Search everything...')).toBeInTheDocument();
  });

  it('shows results grouped by type after typing', async () => {
    renderBar();
    fireEvent.click(screen.getByLabelText('Search'));
    fireEvent.change(screen.getByPlaceholderText('Search everything...'), { target: { value: 'buy' } });
    await waitFor(() => expect(screen.getByText('Tasks')).toBeInTheDocument(), { timeout: 500 });
    expect(screen.getByText('Buy milk')).toBeInTheDocument();
    expect(screen.getByText('Ideas')).toBeInTheDocument();
  });

  it('closes on Escape key', () => {
    renderBar();
    fireEvent.click(screen.getByLabelText('Search'));
    const input = screen.getByPlaceholderText('Search everything...');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByPlaceholderText('Search everything...')).not.toBeInTheDocument();
  });
});
```

**Step 5 — commit:**
```bash
cd "C:/Users/smolentsev/.claude/NewProject/Kanban" && git add apps/web/src/api/search.api.ts apps/web/src/components/search/SearchBar.tsx apps/web/src/App.tsx && git commit -m "feat(search): add live SearchBar component with debounce and grouped results"
```

---

## Summary of All Files Changed

| File | Action | Task |
|------|--------|------|
| `packages/api/src/parsers/docx.parser.ts` | CREATE | 1 |
| `packages/api/src/parsers/image.parser.ts` | CREATE | 2 |
| `packages/api/src/parsers/audio.parser.ts` | CREATE | 3 |
| `packages/api/src/parsers/url.parser.ts` | CREATE | 4 |
| `packages/api/src/parsers/index.ts` | MODIFY | 1–4 |
| `packages/api/src/db/db.ts` | MODIFY | 5 |
| `packages/api/src/services/search.service.ts` | CREATE | 5–6 |
| `packages/api/src/routes/search.ts` | CREATE | 6 |
| `packages/api/src/routes/index.ts` | MODIFY | 6 |
| `packages/api/src/routes/tasks.ts` | MODIFY | 6 |
| `packages/api/src/routes/meetings.ts` | MODIFY | 6 |
| `packages/api/src/routes/ideas.ts` | MODIFY | 6 |
| `packages/api/src/routes/documents.ts` | MODIFY | 6 |
| `packages/api/src/routes/people.ts` | MODIFY | 6 |
| `packages/api/src/routes/ingest.ts` | MODIFY | 4 |
| `packages/api/src/index.ts` | MODIFY | 6 |
| `apps/web/src/api/search.api.ts` | CREATE | 7 |
| `apps/web/src/api/ingest.api.ts` | MODIFY | 4 |
| `apps/web/src/components/search/SearchBar.tsx` | CREATE | 7 |
| `apps/web/src/components/upload/FileIngestion.tsx` | MODIFY | 2–4 |
| `apps/web/src/App.tsx` | MODIFY | 7 |
