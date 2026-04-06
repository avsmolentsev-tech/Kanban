# Personal Intelligence System (PIS)

A personal life and project management system with Obsidian as the source of truth.

## Architecture

```
apps/web          -> React + Vite frontend (port 5173)
packages/api      -> Express REST API (port 3001)
packages/shared   -> Shared TypeScript types
vault/            -> Obsidian vault (source of truth)
data/             -> SQLite database (index only, rebuildable)
```

## How to Run Locally

1. **Prerequisites:** Node.js >= 18, pnpm >= 8

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Configure environment:**
   ```bash
   cp .env.example packages/api/.env
   # Edit .env: set ANTHROPIC_API_KEY and VAULT_PATH
   ```

4. **Start both servers:**
   ```bash
   pnpm dev
   ```
   - API: http://localhost:3001
   - Web: http://localhost:5173

## How to Extend

### Add a new file parser
1. Create `packages/api/src/parsers/docx.parser.ts`
2. Add the case to `packages/api/src/parsers/index.ts`

### Add a new API route
1. Create `packages/api/src/routes/myroute.ts`
2. Register in `packages/api/src/routes/index.ts`

### Add a new filter
1. Add entry to `apps/web/src/components/filters/filterConfig.ts`

### Add a new vault type
1. Add `write*` method to `packages/api/src/services/obsidian.service.ts`

## Vault Rules

- **Never delete** files, use `archived: true`
- **Always use** `[[WikiLinks]]` for cross-references
- SQLite is index only, vault is source of truth

## Future Phases

- **Phase 2:** Image parser (Vision), audio (Whisper), docx, URL ingestion
- **Phase 3:** Mobile app, notifications, calendar
- **Phase 4:** Multi-user, team features
