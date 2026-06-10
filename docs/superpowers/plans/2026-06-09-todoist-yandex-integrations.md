# Todoist + Yandex Calendar Integrations Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bidirectional Todoist sync and Yandex Calendar read integration, both with per-user OAuth.

**Architecture:** Follow the existing Google Calendar pattern — OAuth flow stores tokens in `settings` table per user, dedicated route files, frontend buttons in Calendar integrations menu. Todoist uses REST Sync API for bidirectional sync with project mapping. Yandex Calendar uses CalDAV protocol accessed via Yandex OAuth tokens.

**Tech Stack:** Express routes, PostgreSQL (settings table), Todoist REST API v2, Yandex OAuth + CalDAV, existing `apiGet`/`apiPost` client.

---

## File Structure

**Backend (packages/api/src/):**
- Create: `routes/todoist.ts` — OAuth flow + sync endpoints
- Create: `routes/yandex-calendar.ts` — OAuth flow + events endpoint
- Modify: `routes/index.ts` — register new routers
- Modify: `config/index.ts` — add env vars for Todoist + Yandex OAuth

**Frontend (apps/web/src/):**
- Modify: `pages/CalendarPage.tsx` — add Todoist + Yandex buttons in integrations menu

---

### Task 1: Config — add Todoist + Yandex env vars

**Files:**
- Modify: `packages/api/src/config/index.ts`
- Modify: `packages/api/.env`

- [ ] **Step 1: Add config keys**

In `packages/api/src/config/index.ts`, add after `googleClientSecret` line:

```ts
  todoistClientId: process.env['TODOIST_CLIENT_ID'] ?? '',
  todoistClientSecret: process.env['TODOIST_CLIENT_SECRET'] ?? '',
  yandexClientId: process.env['YANDEX_CLIENT_ID'] ?? '',
  yandexClientSecret: process.env['YANDEX_CLIENT_SECRET'] ?? '',
```

- [ ] **Step 2: Add placeholder env vars**

In `packages/api/.env`, add:

```
TODOIST_CLIENT_ID=
TODOIST_CLIENT_SECRET=
YANDEX_CLIENT_ID=
YANDEX_CLIENT_SECRET=
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/config/index.ts packages/api/.env
git commit -m "chore: add Todoist + Yandex OAuth config vars"
```

---

### Task 2: Todoist OAuth + bidirectional sync backend

**Files:**
- Create: `packages/api/src/routes/todoist.ts`

This is the biggest task. The route handles:
1. OAuth flow (auth → callback → store tokens)
2. Status / disconnect
3. List Todoist projects (for mapping UI)
4. Sync: pull Todoist tasks → create/update in Clarity Space
5. Sync: push Clarity Space task changes → Todoist
6. Project mapping (store user's project-to-project mapping)

- [ ] **Step 1: Create todoist.ts with OAuth flow + helpers**

Create `packages/api/src/routes/todoist.ts`:

```ts
import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import { queryAll, queryOne, execute } from '../db/db';
import { ok, fail } from '@pis/shared';
import { config } from '../config';
import type { AuthRequest } from '../middleware/auth';
import { getUserId } from '../middleware/user-scope';

export const todoistRouter = Router();

// ── Helpers ──

async function getUserSetting(userId: number, key: string): Promise<string | null> {
  const row = await queryOne<{ value: string }>(
    'SELECT value FROM settings WHERE key = $1 AND user_id = $2',
    [key, userId]
  );
  return row?.value ?? null;
}

async function setUserSetting(userId: number, key: string, value: string): Promise<void> {
  await execute(
    `INSERT INTO settings (key, value, user_id) VALUES ($1, $2, $3)
     ON CONFLICT (key, user_id) DO UPDATE SET value = EXCLUDED.value`,
    [key, value, userId]
  );
}

async function deleteUserSettings(userId: number, keys: string[]): Promise<void> {
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(',');
  await execute(
    `DELETE FROM settings WHERE user_id = $${keys.length + 1} AND key IN (${placeholders})`,
    [...keys, userId]
  );
}

async function getTodoistToken(userId: number): Promise<string | null> {
  return getUserSetting(userId, 'todoist_access_token');
}

async function todoistFetch(token: string, path: string, options?: RequestInit): Promise<any> {
  const res = await fetch(`https://api.todoist.com/rest/v2/${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Todoist API ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── OAuth ──

todoistRouter.get('/auth', (req: AuthRequest, res: Response) => {
  if (!config.todoistClientId) { res.status(400).json(fail('TODOIST_CLIENT_ID not configured')); return; }
  const userId = getUserId(req) || (req.query['uid'] ? Number(req.query['uid']) : null);
  if (!userId) { res.status(401).json(fail('Not authenticated')); return; }
  const state = jwt.sign({ userId }, config.jwtSecret, { expiresIn: '10m' });
  const redirectUri = `${config.webappUrl}/v1/todoist/callback`;
  const url = `https://todoist.com/oauth/authorize?client_id=${config.todoistClientId}&scope=data:read_write&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  res.redirect(url);
});

todoistRouter.get('/callback', async (req: AuthRequest, res: Response) => {
  const code = req.query['code'] as string;
  const state = req.query['state'] as string;
  if (!code || !state) { res.status(400).json(fail('Missing code or state')); return; }

  let userId: number;
  try {
    const payload = jwt.verify(state, config.jwtSecret) as { userId: number };
    userId = payload.userId;
  } catch {
    res.status(403).json(fail('Invalid or expired OAuth state'));
    return;
  }

  try {
    const tokenRes = await fetch('https://todoist.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: config.todoistClientId,
        client_secret: config.todoistClientSecret,
        code,
        redirect_uri: `${config.webappUrl}/v1/todoist/callback`,
      }),
    });
    const tokens = await tokenRes.json();
    if (tokens.error) { res.status(400).json(fail(tokens.error)); return; }

    await setUserSetting(userId, 'todoist_access_token', tokens.access_token);

    res.send('<html><body><h2>Todoist подключён!</h2><p>Можете закрыть эту вкладку.</p><script>setTimeout(()=>window.close(),2000)</script></body></html>');
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'OAuth error'));
  }
});

// ── Status / Disconnect ──

todoistRouter.get('/status', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) { res.json(ok({ connected: false })); return; }
  const token = await getTodoistToken(userId);
  res.json(ok({ connected: !!token }));
});

todoistRouter.post('/disconnect', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json(fail('Not authenticated')); return; }
  await deleteUserSettings(userId, ['todoist_access_token']);
  // Also clear project mappings
  await execute("DELETE FROM settings WHERE user_id = $1 AND key LIKE 'todoist_project_map_%'", [userId]);
  res.json(ok({ disconnected: true }));
});

// ── Todoist Projects (for mapping UI) ──

todoistRouter.get('/projects', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json(fail('Not authenticated')); return; }
  const token = await getTodoistToken(userId);
  if (!token) { res.status(400).json(fail('Todoist не подключён')); return; }

  try {
    const projects = await todoistFetch(token, 'projects');
    res.json(ok(projects));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Fetch error'));
  }
});

// ── Project Mapping ──

todoistRouter.get('/mapping', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json(fail('Not authenticated')); return; }
  const rows = await queryAll<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE user_id = $1 AND key LIKE 'todoist_project_map_%'",
    [userId]
  );
  // key = todoist_project_map_{todoist_project_id}, value = clarity_project_id
  const mapping: Record<string, number> = {};
  for (const r of rows) {
    const todoistId = r.key.replace('todoist_project_map_', '');
    mapping[todoistId] = Number(r.value);
  }
  res.json(ok(mapping));
});

todoistRouter.post('/mapping', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json(fail('Not authenticated')); return; }
  const { mapping } = req.body as { mapping: Record<string, number | null> };
  if (!mapping) { res.status(400).json(fail('mapping required')); return; }

  // Clear old mappings
  await execute("DELETE FROM settings WHERE user_id = $1 AND key LIKE 'todoist_project_map_%'", [userId]);
  // Save new
  for (const [todoistProjectId, clarityProjectId] of Object.entries(mapping)) {
    if (clarityProjectId != null) {
      await setUserSetting(userId, `todoist_project_map_${todoistProjectId}`, String(clarityProjectId));
    }
  }
  res.json(ok({ saved: true }));
});

// ── Bidirectional Sync ──

todoistRouter.post('/sync', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json(fail('Not authenticated')); return; }
  const token = await getTodoistToken(userId);
  if (!token) { res.status(400).json(fail('Todoist не подключён')); return; }

  try {
    // Load project mapping
    const mappingRows = await queryAll<{ key: string; value: string }>(
      "SELECT key, value FROM settings WHERE user_id = $1 AND key LIKE 'todoist_project_map_%'",
      [userId]
    );
    // todoist_id → clarity_id
    const projectMap = new Map<string, number>();
    // clarity_id → todoist_id (reverse)
    const reverseMap = new Map<number, string>();
    for (const r of mappingRows) {
      const tid = r.key.replace('todoist_project_map_', '');
      const cid = Number(r.value);
      projectMap.set(tid, cid);
      reverseMap.set(cid, tid);
    }

    if (projectMap.size === 0) {
      res.json(ok({ pulled: 0, pushed: 0, message: 'Нет привязанных проектов. Настройте маппинг.' }));
      return;
    }

    // ── PULL: Todoist → Clarity Space ──
    const todoistTasks: any[] = await todoistFetch(token, 'tasks');
    let pulled = 0;

    for (const tt of todoistTasks) {
      const clarityProjectId = projectMap.get(tt.project_id);
      if (clarityProjectId === undefined) continue; // unmapped project, skip

      // Check if already synced (by todoist_id in settings)
      const existingLink = await getUserSetting(userId, `todoist_task_${tt.id}`);
      if (existingLink) {
        // Update existing task status
        const clarityTaskId = Number(existingLink);
        const newStatus = tt.is_completed ? 'done' : 'todo';
        await execute(
          "UPDATE tasks SET title = $1, status = $2, due_date = $3, updated_at = NOW() WHERE id = $4 AND user_id = $5",
          [tt.content, newStatus, tt.due?.date || null, clarityTaskId, userId]
        );
      } else {
        // Create new task in Clarity Space
        const status = tt.is_completed ? 'done' : 'todo';
        const priority = Math.min(5, Math.max(1, 5 - (tt.priority - 1))); // Todoist: 1=normal,4=urgent → invert
        const inserted = await queryOne<{ id: number }>(
          'INSERT INTO tasks (project_id, title, description, status, priority, due_date, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
          [clarityProjectId, tt.content, tt.description || '', status, priority, tt.due?.date || null, userId]
        );
        if (inserted) {
          await setUserSetting(userId, `todoist_task_${tt.id}`, String(inserted.id));
          await setUserSetting(userId, `clarity_task_todoist_${inserted.id}`, tt.id);
          pulled++;
        }
      }
    }

    // ── PUSH: Clarity Space → Todoist ──
    // Get all tasks from mapped projects that don't have todoist link
    const clarityProjectIds = [...reverseMap.keys()];
    let pushed = 0;

    if (clarityProjectIds.length > 0) {
      const placeholders = clarityProjectIds.map((_, i) => `$${i + 1}`).join(',');
      const clarityTasks = await queryAll<{ id: number; title: string; description: string; status: string; priority: number; due_date: string | null; project_id: number }>(
        `SELECT id, title, description, status, priority, due_date, project_id FROM tasks WHERE project_id IN (${placeholders}) AND user_id = $${clarityProjectIds.length + 1} AND archived = 0`,
        [...clarityProjectIds, userId]
      );

      for (const ct of clarityTasks) {
        const existingLink = await getUserSetting(userId, `clarity_task_todoist_${ct.id}`);
        if (existingLink) {
          // Update existing Todoist task
          try {
            const isCompleted = ct.status === 'done';
            await todoistFetch(token, `tasks/${existingLink}`, {
              method: 'POST',
              body: JSON.stringify({
                content: ct.title,
                description: ct.description || '',
                priority: Math.min(4, Math.max(1, 5 - ct.priority + 1)),
                ...(ct.due_date ? { due_date: ct.due_date } : {}),
              }),
            });
            // Handle completion
            if (isCompleted) {
              try { await todoistFetch(token, `tasks/${existingLink}/close`, { method: 'POST' }); } catch {}
            } else {
              try { await todoistFetch(token, `tasks/${existingLink}/reopen`, { method: 'POST' }); } catch {}
            }
          } catch {}
          continue;
        }

        // Create in Todoist
        const todoistProjectId = reverseMap.get(ct.project_id!);
        if (!todoistProjectId) continue;

        try {
          const created = await todoistFetch(token, 'tasks', {
            method: 'POST',
            body: JSON.stringify({
              content: ct.title,
              description: ct.description || '',
              project_id: todoistProjectId,
              priority: Math.min(4, Math.max(1, 5 - ct.priority + 1)),
              ...(ct.due_date ? { due_date: ct.due_date } : {}),
            }),
          });
          if (created?.id) {
            await setUserSetting(userId, `todoist_task_${created.id}`, String(ct.id));
            await setUserSetting(userId, `clarity_task_todoist_${ct.id}`, created.id);
            pushed++;
            if (ct.status === 'done') {
              try { await todoistFetch(token, `tasks/${created.id}/close`, { method: 'POST' }); } catch {}
            }
          }
        } catch {}
      }
    }

    res.json(ok({ pulled, pushed }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Sync error'));
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/routes/todoist.ts
git commit -m "feat: Todoist OAuth + bidirectional sync backend"
```

---

### Task 3: Yandex Calendar OAuth + events backend

**Files:**
- Create: `packages/api/src/routes/yandex-calendar.ts`

Yandex Calendar uses OAuth for auth, then CalDAV for reading events. For MVP, use Yandex Calendar API (REST-like via CalDAV propfind is complex; Yandex also has a simpler endpoint via their API).

- [ ] **Step 1: Create yandex-calendar.ts**

Create `packages/api/src/routes/yandex-calendar.ts`:

```ts
import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import { queryOne, execute } from '../db/db';
import { ok, fail } from '@pis/shared';
import { config } from '../config';
import type { AuthRequest } from '../middleware/auth';
import { getUserId } from '../middleware/user-scope';

export const yandexCalendarRouter = Router();

async function getUserSetting(userId: number, key: string): Promise<string | null> {
  const row = await queryOne<{ value: string }>(
    'SELECT value FROM settings WHERE key = $1 AND user_id = $2',
    [key, userId]
  );
  return row?.value ?? null;
}

async function setUserSetting(userId: number, key: string, value: string): Promise<void> {
  await execute(
    `INSERT INTO settings (key, value, user_id) VALUES ($1, $2, $3)
     ON CONFLICT (key, user_id) DO UPDATE SET value = EXCLUDED.value`,
    [key, value, userId]
  );
}

// Refresh Yandex token if expired
async function getYandexToken(userId: number): Promise<string | null> {
  const token = await getUserSetting(userId, 'yandex_access_token');
  const expiry = await getUserSetting(userId, 'yandex_token_expiry');
  const refresh = await getUserSetting(userId, 'yandex_refresh_token');

  if (!token) return null;

  if (expiry && Number(expiry) < Date.now() && refresh) {
    try {
      const res = await fetch('https://oauth.yandex.ru/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refresh,
          client_id: config.yandexClientId,
          client_secret: config.yandexClientSecret,
        }),
      });
      const data = await res.json();
      if (data.access_token) {
        await setUserSetting(userId, 'yandex_access_token', data.access_token);
        if (data.refresh_token) await setUserSetting(userId, 'yandex_refresh_token', data.refresh_token);
        await setUserSetting(userId, 'yandex_token_expiry', String(Date.now() + (data.expires_in || 3600) * 1000));
        return data.access_token;
      }
    } catch {}
  }

  return token;
}

// ── OAuth ──

yandexCalendarRouter.get('/auth', (req: AuthRequest, res: Response) => {
  if (!config.yandexClientId) { res.status(400).json(fail('YANDEX_CLIENT_ID not configured')); return; }
  const userId = getUserId(req) || (req.query['uid'] ? Number(req.query['uid']) : null);
  if (!userId) { res.status(401).json(fail('Not authenticated')); return; }
  const state = jwt.sign({ userId }, config.jwtSecret, { expiresIn: '10m' });
  const redirectUri = `${config.webappUrl}/v1/yandex-calendar/callback`;
  const url = `https://oauth.yandex.ru/authorize?response_type=code&client_id=${config.yandexClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}&force_confirm=yes`;
  res.redirect(url);
});

yandexCalendarRouter.get('/callback', async (req: AuthRequest, res: Response) => {
  const code = req.query['code'] as string;
  const state = req.query['state'] as string;
  if (!code || !state) { res.status(400).json(fail('Missing code or state')); return; }

  let userId: number;
  try {
    const payload = jwt.verify(state, config.jwtSecret) as { userId: number };
    userId = payload.userId;
  } catch {
    res.status(403).json(fail('Invalid or expired OAuth state'));
    return;
  }

  try {
    const tokenRes = await fetch('https://oauth.yandex.ru/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: config.yandexClientId,
        client_secret: config.yandexClientSecret,
        redirect_uri: `${config.webappUrl}/v1/yandex-calendar/callback`,
      }),
    });
    const tokens = await tokenRes.json();
    if (tokens.error) { res.status(400).json(fail(tokens.error_description || tokens.error)); return; }

    await setUserSetting(userId, 'yandex_access_token', tokens.access_token);
    if (tokens.refresh_token) await setUserSetting(userId, 'yandex_refresh_token', tokens.refresh_token);
    await setUserSetting(userId, 'yandex_token_expiry', String(Date.now() + (tokens.expires_in || 3600) * 1000));

    res.send('<html><body><h2>Яндекс Календарь подключён!</h2><p>Можете закрыть эту вкладку.</p><script>setTimeout(()=>window.close(),2000)</script></body></html>');
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'OAuth error'));
  }
});

// ── Status / Disconnect ──

yandexCalendarRouter.get('/status', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) { res.json(ok({ connected: false })); return; }
  const token = await getYandexToken(userId);
  res.json(ok({ connected: !!token }));
});

yandexCalendarRouter.post('/disconnect', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json(fail('Not authenticated')); return; }
  await execute(
    "DELETE FROM settings WHERE user_id = $1 AND key IN ('yandex_access_token', 'yandex_refresh_token', 'yandex_token_expiry')",
    [userId]
  );
  res.json(ok({ disconnected: true }));
});

// ── Events (CalDAV via Yandex API) ──

yandexCalendarRouter.get('/events', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) { res.json(ok([])); return; }
  const token = await getYandexToken(userId);
  if (!token) { res.json(ok([])); return; }

  try {
    // Yandex CalDAV: REPORT on default calendar
    const now = new Date();
    const from = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const to = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    const calDavBody = `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><D:getetag/><C:calendar-data/></D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="${from}" end="${to}"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;

    const caldavRes = await fetch('https://caldav.yandex.ru/calendars/default/', {
      method: 'REPORT',
      headers: {
        'Authorization': `OAuth ${token}`,
        'Content-Type': 'application/xml; charset=utf-8',
        'Depth': '1',
      },
      body: calDavBody,
    });

    const xml = await caldavRes.text();

    // Parse iCal events from CalDAV XML response
    const events: Array<{ id: string; summary: string; start: { dateTime?: string; date?: string }; end: { dateTime?: string; date?: string } }> = [];
    const eventBlocks = xml.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];

    for (const block of eventBlocks) {
      const summary = block.match(/SUMMARY:(.*)/)?.[1]?.trim() || 'Без названия';
      const dtstart = block.match(/DTSTART[^:]*:(.*)/)?.[1]?.trim() || '';
      const dtend = block.match(/DTEND[^:]*:(.*)/)?.[1]?.trim() || '';
      const uid = block.match(/UID:(.*)/)?.[1]?.trim() || `yandex-${Date.now()}-${Math.random()}`;

      // Parse date: 20260609T100000Z or 20260609
      const parseIcalDate = (d: string) => {
        if (d.length === 8) return { date: `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}` };
        const iso = `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${d.slice(9,11)}:${d.slice(11,13)}:${d.slice(13,15)}`;
        return { dateTime: iso };
      };

      events.push({
        id: uid,
        summary,
        start: parseIcalDate(dtstart),
        end: parseIcalDate(dtend),
      });
    }

    res.json(ok(events));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'CalDAV error'));
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/routes/yandex-calendar.ts
git commit -m "feat: Yandex Calendar OAuth + CalDAV events backend"
```

---

### Task 4: Register routes in index.ts

**Files:**
- Modify: `packages/api/src/routes/index.ts`

- [ ] **Step 1: Add imports and routes**

Add imports at top of `packages/api/src/routes/index.ts`:

```ts
import { todoistRouter } from './todoist';
import { yandexCalendarRouter } from './yandex-calendar';
```

Add routes in the public section (before `requireAuth`), next to `google-calendar`:

```ts
router.use('/todoist', todoistRouter);
router.use('/yandex-calendar', yandexCalendarRouter);
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/routes/index.ts
git commit -m "chore: register todoist + yandex-calendar routes"
```

---

### Task 5: Frontend — integrations menu with all 3 services

**Files:**
- Modify: `apps/web/src/pages/CalendarPage.tsx`

- [ ] **Step 1: Add Todoist + Yandex state and API calls**

Near the existing `gcalConnected` state, add:

```ts
const [todoistConnected, setTodoistConnected] = useState(false);
const [yandexConnected, setYandexConnected] = useState(false);
const [yandexEvents, setYandexEvents] = useState<GCalEvent[]>([]);
```

In the useEffect that checks gcal status, add:

```ts
apiGet<{ connected: boolean }>('/todoist/status').then(d => setTodoistConnected(d.connected)).catch(() => {});
apiGet<{ connected: boolean }>('/yandex-calendar/status').then(d => setYandexConnected(d.connected)).catch(() => {});
apiGet<GCalEvent[]>('/yandex-calendar/events').then(setYandexEvents).catch(() => {});
```

Merge yandex events into gcalByDate (or create separate yandexByDate map and merge in rendering).

- [ ] **Step 2: Update Yandex Calendar card from "Coming soon" to functional connect/disconnect**

Replace the Yandex Calendar card in the integrations menu with the same pattern as Google Calendar — connect/disconnect buttons that open OAuth URL.

- [ ] **Step 3: Add Todoist card to integrations menu**

Add a Todoist section with:
- Connect/Disconnect buttons
- "Синхронизировать" button (calls POST /todoist/sync)
- Show sync results (pulled/pushed count)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/CalendarPage.tsx
git commit -m "feat: frontend integrations menu with Todoist + Yandex Calendar"
```

---

### Task 6: Build, deploy, test

- [ ] **Step 1: Build API**

```bash
pnpm --filter api build
```

- [ ] **Step 2: Build Web**

```bash
pnpm --filter web build
```

- [ ] **Step 3: Deploy to clarity-space.ru**

```bash
tar cf - packages/api/dist/ apps/web/dist/ | ssh root@31.128.43.174 "cd /var/www/kanban-app && tar xf -"
ssh root@31.128.43.174 "cd /var/www/kanban-app/packages/api && pm2 delete kanban-api && pm2 start dist/index.js --name kanban-api && nginx -s reload"
```

- [ ] **Step 4: Deploy to myaipro.ru**

```bash
tar cf - packages/api/dist/ apps/web/dist/ | ssh root@myaipro.ru "cd /var/www/kanban-app && tar xf -"
ssh root@myaipro.ru "cd /var/www/kanban-app/packages/api && pm2 delete kanban-api && pm2 start dist/index.js --name kanban-api && nginx -s reload"
```

- [ ] **Step 5: Test endpoints**

```bash
# Status should return connected: false (no OAuth tokens yet)
curl -s http://localhost:3002/v1/todoist/status -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:3002/v1/yandex-calendar/status -H "Authorization: Bearer $TOKEN"
```

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: Todoist + Yandex Calendar integrations — OAuth, sync, frontend"
git push origin master
```
