# Obsidian Improvements — Design

**Date:** 2026-04-16
**Status:** Spec, awaiting implementation plan
**Owner:** Slava (user_id=2)

## Purpose

Three complementary improvements to the Obsidian experience in the Kanban/PIS system:

1. **Audio-with-context ingestion.** When Slava sends a voice/audio/file via Telegram, the bot transcribes, extracts metadata (title, project, people, company, tags, type), proposes an inline confirmation card with buttons, and only saves after Slava approves — with the ability to correct any field by voice or text.
2. **Auto-tagging and company field.** Every new meeting/task/idea written to vault gets hierarchical + free tags and a `company` field in frontmatter when available.
3. **Daily Obsidian→Drive backup** of Slava's `.md` files into a Drive folder he created, preserving folder structure.
4. **MCP-Obsidian installation** in the local Claude Code config so vault search/tags/Dataview work through a dedicated tool.

Multi-user architecture remains untouched: all changes stay within `user_id=2` scope; server vault partition `user_2/` is preserved; no flattening of paths.

Non-goals: rewriting the existing meeting-card UI in the web app; changing the Kanban-to-vault sync for pre-existing records; touching openclaw's separate `obsidian_daily_backup_to_gdrive.sh` tarball backup.

## Key Decisions

| Decision | Choice |
|---|---|
| Confirmation UX | Inline buttons per card: `✅ OK` / `✏️ Исправить` / `❌ Отменить` |
| Correction mode | After `✏️`, the very next user message (text or voice) is the edit; Claude re-parses; card redraws |
| Correction options | Edit any field including the detected **type** (meeting/task/idea) |
| Tag namespace | Hierarchical required + free up to 3–5 |
| Filename | `YYYY-MM-DD-slug(title).md` (no project/people in filename) |
| Metadata location | `project`, `people`, `company`, `tags`, `type`, `date`, `source`, `agreements` in YAML frontmatter |
| Company source | Extracted from transcript by Claude, falling back to `people.company` lookup when person is in DB |
| Draft timeout | 30 min; if user doesn't respond, save as-is with current card state (never lose the transcript) |
| New voice while draft pending | Close current draft (save as-is), start new one |
| Drive backup frequency | Daily at 03:15 UTC |
| Drive backup direction | One-way, append + update (no deletions on Drive) |
| Drive backup source | `/var/www/kanban-app/vault/user_2/` only |
| Drive backup destination | Folder `Obsidian` on Slava's Drive, id `1UJ_GSCrisPe-SPV_7aDKihlfgATCCwtP` |
| Drive backup tool | `gog` CLI (already authenticated with Drive scope) |
| MCP Obsidian | Community `mcp-obsidian` server (filesystem-backed; no Obsidian REST plugin dependency) |

## Architecture

```
TG voice/audio/document/photo/text
        │
        ▼
┌────────────────────┐
│ telegram.service   │  transcribe (whisper-local), classify type, extract metadata
│  (@MyBestKanban)   │
└────────┬───────────┘
         │ (draft object in SessionManager, keyed by tgId)
         ▼
┌────────────────────┐
│ Confirmation card  │  inline keyboard [OK] [Fix] [Cancel]
└─────┬───────┬──────┘
      │ OK    │ Fix (next message is edit → re-parse → redraw)
      ▼       │
┌────────────────┐
│ IngestService  │  inserts into DB with user_id=2
└────────┬───────┘
         ▼
┌────────────────┐
│ ObsidianService│  writes vault/user_2/<Type>/<date>-slug.md with frontmatter
└────────┬───────┘
         │
         │ git sync (existing vault-sync.sh)
         ▼
   github.com/.../obsidian-vault
         │
         ├─► Slava's local Obsidian (git pull)
         │
         └─► (NEW) backup-obsidian-md-to-drive.sh (cron daily)
                          │
                          ▼
                   Google Drive / Obsidian folder
```

MCP-Obsidian is a parallel local tool wired to Slava's local vault, unrelated to the server-side ingest flow.

## Components

### 1. Metadata extraction (Claude-parsed)

Replace the current `ClaudeService.parseInboxItem` usage for ingested text with a new prompt that returns, in one pass:

```json
{
  "detected_type": "meeting" | "task" | "idea" | "inbox",
  "title": "...",
  "date": "YYYY-MM-DD",
  "project_hints": ["..."],
  "company_hints": ["..."],
  "people": ["..."],
  "tags_hierarchical": ["type/meeting", "project/<slug>"],
  "tags_free": ["прототип", "финансы"],
  "summary": "...",
  "agreements": 0,
  "tasks": ["extracted task 1", "extracted task 2"]
}
```

The existing `matchProject` and `matchPeople` stay unchanged but now also gets `company_hints`. New helper `matchCompany` looks up `people.company` where `people.user_id = userId` and returns the best match, or returns the literal hint verbatim (to be created fresh if user confirms).

### 2. Draft state (SessionManager extension)

A new `PendingDraft` keyed by `tgId`:

```ts
interface PendingDraft {
  tgId: number;
  userId: number;
  createdAt: number;
  type: 'meeting' | 'task' | 'idea' | 'inbox';
  title: string;
  date: string;
  projectName: string | null;    // resolvable name; null = "no project"
  companyName: string | null;
  people: string[];
  tags: string[];                // canonicalized, includes hierarchical + free
  summary: string;
  transcript: string;            // preserved verbatim
  sourceFilePath?: string;        // for uploaded documents/photos
  sourceFileKind?: 'voice' | 'audio' | 'document' | 'photo' | 'text';
  messageId?: number;             // the TG message id of the card we're editing
  awaitingEdit: boolean;         // true = next user message is a correction
  timeoutHandle?: NodeJS.Timeout;
}
```

Stored in memory only (`Map<number, PendingDraft>` on `KanbanBot`). On 30-min timeout: auto-save via `IngestService` using current fields. On graceful bot shutdown: save all pending drafts.

### 3. Confirmation card

Markdown card posted after transcription:

```
📝 Расшифровано (меlking).

Тип: встреча
Название: Обсуждение прототипа робота-мойщика
Дата: 2026-04-16
Проект: Роботы-мойщики
Компания: Keenon Robotics
Люди: Максим, Ян
Теги: #type/meeting, #project/roboty-mojshiki, #прототип, #команда

──────────
[✅ OK]  [✏️ Исправить]  [❌ Отменить]
[📋 Это задача]  [💡 Это идея]  [🤝 Это встреча]
```

- Second row of type-buttons is shown only if `detected_type != 'task' && != 'idea'` combinations make sense — full row is shown by default for flexibility.
- `callback_data` encodes draft id + action: e.g. `draft:abc123:ok`, `draft:abc123:fix`, `draft:abc123:cancel`, `draft:abc123:as-task`.
- On `✅`: save via `IngestService`, reply `✅ Сохранено: <vault_path>`.
- On `✏️`: reply `Что поменять? Напиши или надиктуй.`, set `awaitingEdit=true`.
- On type change (`📋 Это задача` etc.): mutate `type` in draft, redraw card, stay in confirmation.
- On `❌`: delete draft, reply `❌ Отменено, транскрипт сохранён: <path to transcript>.txt` (never lose the words).

### 4. Correction loop

When `awaitingEdit=true`, the next user message (text or voice) is captured:

1. Transcribe if voice.
2. Pass to Claude with prompt: "Here is a draft card as JSON: `<draft_json>`. User wants to apply this correction: `<user_text>`. Return the updated draft as JSON with the same shape."
3. Redraw card with same draft id, new fields.
4. `awaitingEdit = false` again; user still interacts via buttons.

### 5. Vault format (ObsidianService)

Existing `writeMeeting` / `writeTask` / `writeIdea` keep the `${date}-${slug(title)}.md` filename. Expand the frontmatter schema:

```yaml
---
type: meeting | task | idea
date: YYYY-MM-DD
project: [[<Project Name>]] | null
company: [[<Company Name>]] | null
people: [[Name A]], [[Name B]]
tags: [type/meeting, project/roboty-mojshiki, прототип, команда]
source: telegram-voice | telegram-audio | telegram-document | telegram-photo | telegram-text | web-ingest
agreements: <int>      # meetings only
---
```

- `project`, `company` written as wiki-links (or `null` literal when empty).
- `tags` stored as YAML list. Hierarchical tags always include `type/<type>`; add `project/<slug(project)>` when project set; add `company/<slug(company)>` when company set; add `category/<slug(category)>` for ideas. Free tags (up to 5) appended as plain strings. Obsidian treats `type/meeting`, `project/X`, `company/Y` as nested tag paths that show in the Tag pane.
- Body continues to open with `# <title>`, `**Дата:**`, `**Проект:**`, `**Участники:**` (so that wiki-links also appear in body for Graph/Backlinks). Add `**Компания:**` line when company set.
- Existing `meetingFileName()` signature unchanged. No breaking changes to tasks/ideas filenames.

### 6. Daily Drive backup

`/usr/local/bin/backup-obsidian-md-to-drive.sh` (NOT under `/root/.openclaw/...`):

1. `export GOG_KEYRING_PASSWORD` from `/root/.openclaw/.env`.
2. `SRC=/var/www/kanban-app/vault/user_2`, `DST_ROOT=1UJ_GSCrisPe-SPV_7aDKihlfgATCCwtP`.
3. Build a map `relpath -> driveFolderId`:
   - `gog drive ls --parent <DST_ROOT> --type folder --plain` top-level.
   - For each subfolder, recurse; cache in `/var/lib/backup-obsidian/folder-map.tsv`.
4. Walk `SRC` with `find -type d`; for each subdir relative to SRC, ensure a matching Drive folder exists (create via `gog drive mkdir --parent <parentId> <name>` when missing).
5. Walk `SRC` with `find -name '*.md'`; for each file, compare local mtime against cached last-upload time (in `/var/lib/backup-obsidian/file-times.tsv`). If changed or new:
   - Delete prior Drive version (if id cached) via `gog drive rm <id>`.
   - `gog drive upload <path> --parent <folderId>`.
   - Update cache with new Drive file id + mtime.
6. Skip: `.git/`, `.trash/`, `.obsidian/`, non-`.md` files.
7. Log to `/var/log/backup-obsidian-md.log` (rotation via logrotate with weekly retention).
8. Cron: `15 3 * * * /usr/local/bin/backup-obsidian-md-to-drive.sh`.

Append-only on the Drive side: if Slava deletes a vault note, the Drive copy remains (safety net). Documented explicitly.

### 7. MCP-Obsidian (local)

Install the community `mcp-obsidian` filesystem MCP server in Claude Code's user-level config (not project-scoped, so it's available everywhere):

```bash
claude mcp add obsidian -- npx -y @smithery/mcp-obsidian --vault-path "C:\\Users\\smolentsev\\Documents\\ObsidianVault\\user_2"
```

Vault path points directly at `user_2/` — Slava's actual working vault. Preserves multi-user boundary.

Capabilities gained in this Claude Code (local): structured tag queries, Dataview-like frontmatter filtering, backlinks, list of unresolved wiki-links. Read-only by default; `--write` can be added later if needed.

## Commands and callback data

New Telegraf callback_query handlers in `telegram.service.ts`:

- `draft:<id>:ok` — save, delete draft, confirmation reply.
- `draft:<id>:fix` — set awaitingEdit, prompt for correction.
- `draft:<id>:cancel` — delete draft + save raw transcript to vault `Inbox/`.
- `draft:<id>:as-meeting` | `:as-task` | `:as-idea` — mutate type, redraw card.

Existing commands untouched.

## Storage schema (DB)

No DB schema changes required in initial cut. `tasks.tags`, `meetings.tags`, `ideas.tags` already exist as TEXT (JSON array). `meetings.company` does not exist today; add a nullable TEXT column via migration `apps/claude-ops-bot`... actually in `packages/api/src/db/migrations/` per existing Kanban migration pattern. Defer if Kanban doesn't currently use it anywhere other than vault frontmatter — keep `company` purely in vault frontmatter for v1 and only add DB column when web UI needs it. Mark this as deferred.

## Security considerations

- Token for Drive is in gog keyring (protected). Backup script uses `GOG_KEYRING_PASSWORD` from `/root/.openclaw/.env`.
- Drive folder `Obsidian` (`1UJ_GSC...`) is Slava's own; no third-party access.
- Backup is append-only → reduces risk of mass deletion via compromised cron.
- MCP-Obsidian runs locally, accesses only the configured vault path.

## Risks & open points

- **Claude cost per voice message grows** (now two calls: extraction + possible correction). Mitigation: use Sonnet for extraction (cheap), only fall back to Opus when explicitly commanded via `/opus`.
- **Race between voice-while-editing and timeout.** If user is mid-edit and 30 min expires, the timeout saves the old state. Mitigation: touch the timeout whenever user interacts with the draft.
- **Drive backup first run is slow.** ~600 files × API call ≈ 5–10 min. Mitigation: run first pass manually, flag log, subsequent runs only upload changed files.
- **Wiki-link creation:** when `[[Keenon Robotics]]` is written but no corresponding `.md` file exists, Obsidian shows it as unresolved. Acceptable — user can click to create when wanted. Do not auto-create stubs (would clutter vault).

## Success criteria

1. Slava sends a 3-min voice: "Встречался с Максимом из Keenon Robotics обсуждали прототип робота-мойщика для Мегамарта". Bot transcribes, card shows `Тип: встреча, Проект: Роботы-мойщики, Компания: Keenon Robotics, Люди: Максим, Теги: #type/meeting, #project/roboty-mojshiki, #company/keenon-robotics, #прототип, #мегамарт`. Slava taps `✅`. File created at `vault/user_2/Meetings/2026-04-16-prototip-robota-mojshika-dlya-megamarta.md` with correct frontmatter (including `company: [[Keenon Robotics]]`).
2. In Obsidian, Slava types `#company/keenon-robotics` in the tag pane — all past meetings/tasks/ideas with Keenon show up. Alternatively he opens `Keenon Robotics.md` and Backlinks show the same set.
3. Slava taps `✏️`, says "это задача, проект Банковские карты". Card redraws as task, project changed. Taps `✅`, file appears under `Tasks/`.
4. At 03:15 UTC next day, `/var/log/backup-obsidian-md.log` shows successful backup; Slava's Drive `Obsidian` folder has the same folder tree as `user_2/`.
5. In Slava's local Claude Code (`claude mcp list`) shows `obsidian` connected. `Can you list all notes tagged #project/roboty-mojshiki?` returns the right list from his local vault without requiring a running Obsidian app.
