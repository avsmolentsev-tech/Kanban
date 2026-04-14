# Claude Ops Bot — Design

**Date:** 2026-04-14
**Status:** Spec, awaiting implementation plan
**Owner:** Slava (tg_id 849367993)

## Purpose

Give Slava a private Telegram bot that routes his messages (text / forwarded files / voice) into Claude Code running on the production server (213.139.229.148), so Claude can autonomously modify any whitelisted repository or folder, push changes, and report back. Also usable to query/update the Obsidian vault, which lives on the same server.

Non-goals: multi-user access, public bot, running Claude Code on separate infra.

## Key Decisions

| Decision | Choice |
|---|---|
| Autonomy | Full auto (Claude commits & pushes itself) |
| Repo scope | Any target from a whitelist (git repos + plain folders like Obsidian vault) |
| Git safety | Hybrid: small local changes auto-merge; larger or sensitive changes wait for explicit `/merge` |
| Bot identity | New bot (distinct token from `@MyBestKanban_bot`) |
| Runtime host | Same server, separate PM2 process |
| Interaction | Session-based, 30 min inactivity timeout |
| Target selection | Auto-infer from message, override via `/use <target>` |
| Input types | Text, forwarded files, voice (Whisper) |
| Auth | Whitelist of one: `ALLOWED_TG_ID=849367993` |
| Model | Sonnet 4.5 default; `/opus` to switch the next round |
| Billing | Claude Code CLI authenticated via existing Claude Max OAuth |
| Rollback | `/rollback` reverts last Claude commit (git) or restores file backup (folder target) |

## Architecture

```
┌─────────┐  msg   ┌──────────────┐   spawn   ┌───────────────────┐
│   TG    │──────▶│ claude-ops-  │──────────▶│ claude -p         │
│  user   │◀──────│ bot (Node)   │◀──stdout──│ bypassPermissions │
└─────────┘ reply │ (PM2)        │           │ cwd=<target>      │
                  └──────┬───────┘           └───────────────────┘
                         │
                         ▼
                 ┌──────────────┐
                 │ Whisper (re- │
                 │ used from    │
                 │ kanban-api)  │
                 └──────────────┘
```

- Separate PM2 process `claude-ops-bot` alongside `kanban-api`.
- No shared HTTP server; the bot only uses Telegraf long-polling + local subprocess pipes.
- Whisper service imported as a local module (no network hop).

## Components

### TG layer (`bot.ts`)
- Telegraf instance with its own token (`TELEGRAM_OPS_BOT_TOKEN`).
- Middleware rejects any `ctx.from.id` not matching `ALLOWED_TG_ID`.
- `handlerTimeout: Infinity` (Claude rounds can run tens of minutes).
- Handlers for: text, voice, audio, document, photo, and the command set below.

### SessionManager (`session.ts`)
- In-memory map `tg_id → Session`.
- `Session` fields:
  - `tgId`
  - `activeTarget` (resolved repo/folder path)
  - `claudeProcess` (`ChildProcess` | null — null between rounds)
  - `stdinQueue` (strings awaiting delivery to Claude)
  - `lastActivityTs`
  - `currentRoundModel` (`sonnet` | `opus`)
  - `pendingUserAnswer` (Claude blocked waiting on stdin)
- Inactivity timer fires at 30 min → kills any running process, purges session.
- State persisted to `~/.claude-ops/sessions/<tg_id>.json` so a bot restart resumes the active target and log pointer (but not the in-flight Claude process — that is killed on exit).

### ClaudeRunner (`claude-runner.ts`)
- `startRound(session, userInput: string): Promise<RoundResult>`
- Internally:
  - If no existing `claudeProcess`, spawn `claude -p bypassPermissions --model <model>` with `cwd = session.activeTarget`.
  - Write `userInput` + newline to stdin.
  - Pipe stdout through a line-aware chunker → forward to TG in ≤3500-char messages.
  - Detect "Claude asks a question" pattern (heuristic: process stdout idle for >3s with a trailing line that ends in `?` or known prompt markers) → mark `pendingUserAnswer=true`, prefix TG message with "❓ Claude ждёт ответа:".
  - When process emits a completion marker (Claude Code prints a structured final block) or exits, resolve with `RoundResult`.
- `stopRound()` sends SIGINT, falls back to SIGKILL after 5s.

### ProjectResolver (`project-resolver.ts`)
- Whitelist in `~/.claude-ops/repos.json`:
  ```json
  [
    {"name": "kanban", "path": "/var/www/kanban-app", "type": "git"},
    {"name": "vault", "path": "/var/www/kanban-app/vault/user_2", "type": "folder"}
  ]
  ```
  Additional repos are added via `/add-repo <absolute_path>`. (Note: openclaw is intentionally NOT in the default whitelist.)
- `/add-repo <absolute_path>` validates path exists, detects type (`.git/` present ⇒ git, else folder), appends entry.
- `resolve(message, currentTarget): Target` — if `/use <name>` used, trivial. Otherwise a lightweight inference step:
  - If user's message mentions a target name literally → pick it.
  - Else if the session already has `activeTarget` set → keep it.
  - Else call Claude (short Sonnet call) to classify the message against the whitelist → pick one, with "ask user" fallback if confidence is low.

### GitSafety (`git-safety.ts`)
- Runs only when `target.type === 'git'`.
- After a Claude round completes, inspects `git status` + `git diff HEAD~1`:
  - If the round produced no commit → nothing to do, report "no changes".
  - Else classify:
    - **small** iff *all* conditions hold:
      - `git diff --stat HEAD~1` shows ≤3 files changed
      - Total added+removed lines ≤200
      - None of the changed files match blacklist globs: `**/auth*`, `**/user-scope*`, `**/db/schema*`, `**/migrations/*`, `.env*`, `.github/workflows/*`, `package.json`, `pnpm-lock.yaml`
      - If a test script is defined in `package.json`, `pnpm test` exits 0 within 5 min
    - Otherwise **large**.
- Behaviour:
  - **small** → `git push origin HEAD` (Claude already committed to master) → TG success message with SHA.
  - **large** → `git branch claude/YYYY-MM-DD-HHMM-<slug>` then move master back with `git reset --hard origin/master`, push the branch. TG message prompts `/merge claude/<branch>`.
- `/merge <branch>` runs `git checkout master && git merge --ff-only <branch> && git push`.
- `/rollback` runs `git revert --no-edit HEAD && git push`. Only reverts commits whose author email matches a configured list (Claude's git config).

### FolderSafety (`folder-safety.ts`)
- For `target.type === 'folder'` (the vault).
- Before each round: snapshot the target into `~/.claude-ops/backups/<session_id>/<ts>/` (hard-linked copy to save space — vault can be large).
- `/rollback` for a folder target restores the most recent snapshot.
- Last 5 snapshots retained per session.

### WhisperAdapter (`whisper.ts`)
- Thin wrapper around the existing `whisper-local.service.ts` from `packages/api`.
- Voice TG message → download file buffer → `transcribeLocal(buffer, name)` → feed transcript to the normal message flow.
- Reuse the same ffmpeg-based `compressForTranscription` path.

## Commands

| Command | Effect |
|---|---|
| (text/file/voice) | New instruction in current session; starts a session if none |
| `/use <name>` | Switch active target |
| `/repos` | List whitelist + mark active |
| `/status` | Show active target, running? round duration, last stdout line |
| `/stop` | SIGINT current round |
| `/end` | Close session |
| `/merge <branch>` | ff-only merge of a Claude large-change branch |
| `/rollback` | Revert last Claude commit (git) or restore last backup (folder) |
| `/opus` | Next round runs on Opus |
| `/log` | Last 200 lines of current session stdout |
| `/add-repo <path>` | Add to whitelist |

## Message flow example (git repo, small change)

1. Slava: "почини баг с кнопкой сохранить на странице задач, она не реагирует"
2. Bot: project inferred → kanban. Sends "🚀 Kanban: старт раунда (Sonnet)".
3. Spawns `claude -p bypassPermissions --model sonnet`, writes message to stdin.
4. Claude stdout streamed to TG in chunks.
5. Claude commits `fix(tasks): ...` to master.
6. Round finishes. GitSafety: 1 file / 12 lines, no blacklist hits, tests pass → small.
7. `git push origin master` → GitHub Actions deploy fires.
8. Bot: "✅ Влито (abc1234). Deploy в процессе."

## Message flow example (vault)

1. Slava: "найди в обсидиане заметки про роботов за апрель и собери краткое резюме"
2. Bot infers `vault` target. Creates snapshot. Spawns Claude with cwd=vault path.
3. Claude greps vault, produces summary to stdout → streamed to TG.
4. No commit required (vault is a folder). Round ends with summary message.

## Message flow example (vault + kanban)

1. Slava: "в обсидиане есть заметка про V-Payment; по ней заведи задачи в Kanban"
2. Inference is ambiguous → Claude is asked (short classify call) → picks `kanban` as primary target (writes happen there), with vault as read-only context.
3. Bot spawns Claude with cwd=kanban, but includes `/var/www/kanban-app/vault/user_2/` as an explicit hint in the first stdin prompt.
4. Claude reads vault note, creates tasks via the codebase (API or direct DB according to its own judgment), commits.
5. GitSafety decides small/large, proceeds as normal.

## Storage layout

```
~/.claude-ops/
  repos.json               # whitelist
  sessions/
    <tg_id>.json           # persisted session metadata
  logs/
    <session_id>.log       # rotated weekly
  backups/
    <session_id>/
      <ts>/…               # folder target snapshots (hard-linked)
```

## Repo layout

```
apps/claude-ops-bot/
  src/
    index.ts
    bot.ts
    session.ts
    claude-runner.ts
    git-safety.ts
    folder-safety.ts
    project-resolver.ts
    whisper.ts               # re-exports from packages/api
  package.json
  tsconfig.json
  .env.example
```

PM2 entry: `pnpm --filter @pis/claude-ops-bot start` via `pm2 start ecosystem.config.js`.
Deploy: extend `.github/workflows/deploy.yml` with a step to restart `claude-ops-bot` after pulling.

## Configuration

`.env` fields added to the server (in `apps/claude-ops-bot/.env`):
- `TELEGRAM_OPS_BOT_TOKEN` — new bot from BotFather
- `ALLOWED_TG_ID=849367993`
- `CLAUDE_OPS_STATE_DIR=~/.claude-ops` (default)
- `SESSION_TIMEOUT_MINUTES=30`
- `DEFAULT_MODEL=sonnet`

Claude Code CLI uses existing Max OAuth credentials on the server; no API key is configured.

## Security considerations

- Single-tg-id whitelist enforced at the earliest middleware.
- Bot token stored only in `apps/claude-ops-bot/.env`, gitignored.
- `claude -p bypassPermissions` runs with full file-system rights of the `root` user, same as `kanban-api` today. Mitigation is purely the tg_id check + the whitelist of target paths: ProjectResolver refuses paths outside the whitelist for `/use` and `/add-repo`.
- `.env.example` files contain only placeholders. The real `.env` lives only on the server.
- Backup directory is chmod 700.

## Risks & open points

- **Question-detection heuristic is fragile.** If Claude asks something and the bot misses it, the session may hang. Mitigation: `/status` shows "idle 2m waiting on stdout" and `/stop` kills cleanly.
- **Classifier false negatives.** A "small" change that touches subtle logic can still break prod. Mitigation: `/rollback` is one message away; user can also whitelist additional sensitive paths over time.
- **Concurrency.** Only one active round per session; new incoming messages during a round are queued and delivered to Claude stdin when the previous round ends or wait until Slava sends them during the session.
- **Vault backups grow.** Hard-linked snapshots are cheap on filesystems that support them (ext4 yes). Keep only last 5 per session.
- **No tests yet for the bot.** The implementation plan should introduce a minimal integration test that mocks Telegraf + the Claude child process.

## Success criteria

1. Slava sends a plain-text bug description to the new bot → within 5 min a fix is deployed to `kanban.myaipro.ru` (small-change path).
2. Slava forwards a screenshot of a vault note and says "заведи по ней задачи" → tasks appear in his Kanban.
3. Slava sends `/rollback` after a bad change → revert commit appears on master and auto-deploy restores the previous state.
4. Any other tg_id that messages the bot gets a single "not authorized" reply and their message does not enter session state.
