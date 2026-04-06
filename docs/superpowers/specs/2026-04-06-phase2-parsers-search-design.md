# Phase 2: Parsers + Full-text Search — Design Spec
**Date:** 2026-04-06

---

## Overview

Extend the PIS file ingestion pipeline with 4 new parsers (docx, image, audio, URL) and add full-text search with live search UI across all pages.

---

## 1. Docx Parser

**File:** `packages/api/src/parsers/docx.parser.ts`

Uses `mammoth` (already installed) to extract text from .docx files.

```
.docx buffer → mammoth.extractRawText() → plain text string
```

Register in `parsers/index.ts` switch: case 'docx' → parseDocx.

---

## 2. Image Parser (OpenAI Vision)

**File:** `packages/api/src/parsers/image.parser.ts`

Sends image to OpenAI `gpt-4o` with vision capability.

```
image buffer → base64 encode → openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: 'Describe this image and extract all text visible in it.' },
      { type: 'image_url', image_url: { url: 'data:image/{ext};base64,{data}' } }
    ]
  }]
}) → text
```

Supports: .png, .jpg, .jpeg

Uses `config.openaiApiKey` via OpenAI SDK (already installed).

---

## 3. Audio Parser (Whisper API)

**File:** `packages/api/src/parsers/audio.parser.ts`

Sends audio to OpenAI Whisper for transcription.

```
audio buffer → write to temp file → openai.audio.transcriptions.create({
  model: 'whisper-1',
  file: fs.createReadStream(tempFile),
  language: auto-detect (supports Russian + English)
}) → transcription text → delete temp file
```

Supports: .mp3, .wav, .m4a, .ogg

---

## 4. URL Parser

**File:** `packages/api/src/parsers/url.parser.ts`

Two-stage extraction:
1. **Cheerio** (fast): fetch URL → parse HTML → extract `<title>`, `<article>`, `<main>`, or `<body>` text
2. **OpenAI fallback**: if extracted text < 100 chars, send raw HTML to GPT-4o-mini with prompt "Extract the main content from this HTML"

```
URL → fetch HTML → cheerio extract text
  → if text.length < 100 → OpenAI extract from HTML
  → return title + text
```

Dependencies to add: `cheerio`

No puppeteer — keeps deployment simple, OpenAI fallback handles JS-rendered pages adequately.

---

## 5. Full-text Search

### Backend

**FTS5 table:** `search_index`
```sql
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  type,       -- 'task' | 'meeting' | 'idea' | 'document' | 'person'
  ref_id,     -- ID in the source table
  title,
  body,
  content=''  -- contentless FTS5, we manage content ourselves
);
```

**Indexing strategy:**
- **On create/update**: insert/update into `search_index` when any record is created or modified via API routes
- **Vault watcher**: `fs.watch` on vault directory — when .md files change, re-index them
- **Full reindex**: `POST /v1/search/reindex` — scans all tables + vault files, rebuilds search_index
- **On startup**: run full reindex once

**Search endpoint:** `GET /v1/search?q={query}`
```json
{
  "success": true,
  "data": [
    { "type": "task", "ref_id": 5, "title": "...", "snippet": "...matched text...", "rank": -1.5 },
    { "type": "meeting", "ref_id": 2, "title": "...", "snippet": "...", "rank": -2.1 }
  ]
}
```

Uses FTS5 `rank` for relevance sorting, `snippet()` for highlighted excerpts.

### Frontend

**Live search in header** — shared across all pages:
- Search icon in the top bar (right side)
- Click → expands to input field
- Debounced (300ms) — fetches results as you type
- Dropdown shows results grouped by type (Tasks, Meetings, Ideas, Documents, People)
- Click result → navigates to the relevant page and opens the detail panel
- Escape → closes search

**File:** `apps/web/src/components/search/SearchBar.tsx`

Placed in `App.tsx` header, above the main content area.

---

## Files to Create/Modify

### New files:
- `packages/api/src/parsers/docx.parser.ts`
- `packages/api/src/parsers/image.parser.ts`
- `packages/api/src/parsers/audio.parser.ts`
- `packages/api/src/parsers/url.parser.ts`
- `packages/api/src/services/search.service.ts`
- `packages/api/src/routes/search.ts`
- `apps/web/src/components/search/SearchBar.tsx`
- `apps/web/src/api/search.api.ts`

### Modified files:
- `packages/api/src/parsers/index.ts` — add docx/image/audio/url cases
- `packages/api/src/db/db.ts` — add FTS5 table creation + vault watcher init
- `packages/api/src/routes/index.ts` — register search router
- `packages/api/src/routes/tasks.ts` — index on create/update
- `packages/api/src/routes/meetings.ts` — index on create/update
- `packages/api/src/routes/ideas.ts` — index on create/update
- `packages/api/src/routes/documents.ts` — index on create/update
- `packages/api/src/routes/people.ts` — index on create/update
- `packages/api/src/routes/ingest.ts` — accept 'url' type for URL ingestion
- `apps/web/src/App.tsx` — add SearchBar to layout

### Dependencies to add:
- `cheerio` (URL parsing)
- No new frontend deps needed

---

## Tech Decisions

- **gpt-4o** for image recognition (better quality)
- **gpt-4o-mini** for URL HTML fallback (cheaper, sufficient)
- **whisper-1** for audio transcription
- **cheerio + OpenAI fallback** for URLs (no puppeteer)
- **FTS5 contentless** for search (fast, rebuildable)
- **fs.watch** for vault live indexing
- **300ms debounce** for live search UI
