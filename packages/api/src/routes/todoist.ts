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
  const res = await fetch(`https://api.todoist.com/api/v1/${path}`, {
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
  const data = await res.json();
  // v1 API wraps lists in { results: [...] }
  if (data && Array.isArray(data.results) && !path.includes('/close') && !path.includes('/reopen')) {
    return data.results;
  }
  return data;
}

// ── OAuth ──

todoistRouter.get('/auth', (req: AuthRequest, res: Response) => {
  if (!config.todoistClientId) { res.status(400).json(fail('TODOIST_CLIENT_ID not configured')); return; }
  const userId = getUserId(req); // from JWT only — no ?uid query override (auth bypass)
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

// ── Connect by token (no OAuth) ──

todoistRouter.post('/connect-token', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json(fail('Not authenticated')); return; }
  const { token } = req.body as { token?: string };
  if (!token) { res.status(400).json(fail('Token required')); return; }

  // Verify token works
  try {
    const resp = await fetch('https://api.todoist.com/api/v1/projects', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!resp.ok) { res.status(400).json(fail('Неверный токен Todoist')); return; }
  } catch {
    res.status(400).json(fail('Ошибка проверки токена')); return;
  }

  await setUserSetting(userId, 'todoist_access_token', token);
  res.json(ok({ connected: true }));
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

    // ── Get Todoist projects ──
    const todoistProjects: any[] = await todoistFetch(token, 'projects');
    const todoistProjectByName = new Map<string, string>(); // name → todoist_id
    const todoistProjectById = new Map<string, string>(); // todoist_id → name
    for (const tp of todoistProjects) {
      todoistProjectByName.set(tp.name.toLowerCase(), tp.id);
      todoistProjectById.set(tp.id, tp.name);
    }

    // ── Get Clarity Space projects ──
    const clarityProjects = await queryAll<{ id: number; name: string }>(
      'SELECT id, name FROM projects WHERE user_id = $1 AND archived = 0',
      [userId]
    );
    const clarityProjectById = new Map<number, string>(); // id → name
    for (const cp of clarityProjects) {
      clarityProjectById.set(cp.id, cp.name);
    }

    // ── Auto-create Todoist projects for Clarity projects that don't exist ──
    // clarity_id → todoist_project_id
    const clarityToTodoist = new Map<number, string>();
    let projectsCreated = 0;

    for (const cp of clarityProjects) {
      // Check saved mapping first
      const savedTodoistId = reverseMap.get(cp.id);
      if (savedTodoistId) {
        clarityToTodoist.set(cp.id, savedTodoistId);
        continue;
      }
      // Find by name
      const existingTodoistId = todoistProjectByName.get(cp.name.toLowerCase());
      if (existingTodoistId) {
        clarityToTodoist.set(cp.id, existingTodoistId);
        // Save mapping for next time
        await setUserSetting(userId, `todoist_project_map_${existingTodoistId}`, String(cp.id));
        projectMap.set(existingTodoistId, cp.id);
        reverseMap.set(cp.id, existingTodoistId);
        continue;
      }
      // Create in Todoist
      try {
        const created = await todoistFetch(token, 'projects', {
          method: 'POST',
          body: JSON.stringify({ name: cp.name }),
        });
        if (created?.id) {
          clarityToTodoist.set(cp.id, created.id);
          await setUserSetting(userId, `todoist_project_map_${created.id}`, String(cp.id));
          projectMap.set(created.id, cp.id);
          reverseMap.set(cp.id, created.id);
          todoistProjectByName.set(cp.name.toLowerCase(), created.id);
          projectsCreated++;
        }
      } catch {}
    }

    // ── PULL: Todoist → Clarity Space ──
    const todoistTasks: any[] = await todoistFetch(token, 'tasks');
    let pulled = 0;

    for (const tt of todoistTasks) {
      if (tt.is_completed) continue;

      // Find clarity project from mapping
      const clarityProjectId = projectMap.get(tt.project_id) ?? null;

      const existingLink = await getUserSetting(userId, `todoist_task_${tt.id}`);
      if (existingLink) {
        const clarityTaskId = Number(existingLink);
        await execute(
          "UPDATE tasks SET title = $1, due_date = $2, updated_at = NOW() WHERE id = $3 AND user_id = $4",
          [tt.content, tt.deadline?.date || tt.due?.date || null, clarityTaskId, userId]
        );
      } else {
        const priority = Math.min(5, Math.max(1, 5 - (tt.priority - 1)));
        const inserted = await queryOne<{ id: number }>(
          'INSERT INTO tasks (project_id, title, description, status, priority, due_date, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
          [clarityProjectId, tt.content, tt.description || '', 'todo', priority, tt.deadline?.date || tt.due?.date || null, userId]
        );
        if (inserted) {
          await setUserSetting(userId, `todoist_task_${tt.id}`, String(inserted.id));
          await setUserSetting(userId, `clarity_task_todoist_${inserted.id}`, tt.id);
          pulled++;
        }
      }
    }

    // ── PUSH: Clarity Space → Todoist ──
    let pushed = 0;
    const allTasks = await queryAll<{ id: number; title: string; description: string; status: string; priority: number; due_date: string | null; project_id: number | null }>(
      "SELECT id, title, description, status, priority, due_date, project_id FROM tasks WHERE user_id = $1 AND archived = 0",
      [userId]
    );

    const todoistOpenIds = new Set(todoistTasks.filter((t: any) => !t.is_completed).map((t: any) => String(t.id)));

    for (const ct of allTasks) {
      const existingLink = await getUserSetting(userId, `clarity_task_todoist_${ct.id}`);

      if (existingLink) {
        // Task already linked — sync completion
        if (ct.status === 'done' && todoistOpenIds.has(existingLink)) {
          try { await todoistFetch(token, `tasks/${existingLink}/close`, { method: 'POST' }); pushed++; } catch {}
        }
        continue;
      }

      // New task — push to Todoist
      if (ct.status === 'done') continue; // don't push already done tasks

      const todoistProjectId = ct.project_id ? clarityToTodoist.get(ct.project_id) : undefined;

      try {
        const created = await todoistFetch(token, 'tasks', {
          method: 'POST',
          body: JSON.stringify({
            content: ct.title,
            description: ct.description || '',
            priority: Math.min(4, Math.max(1, 5 - ct.priority + 1)),
            ...(todoistProjectId ? { project_id: todoistProjectId } : {}),
            ...(ct.due_date ? { deadline: { date: ct.due_date } } : {}),
          }),
        });
        if (created?.id) {
          await setUserSetting(userId, `todoist_task_${created.id}`, String(ct.id));
          await setUserSetting(userId, `clarity_task_todoist_${ct.id}`, created.id);
          pushed++;
        }
      } catch {}
    }

    res.json(ok({ pulled, pushed, projectsCreated }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Sync error'));
  }
});

// ── Background Sync ──

const SYNC_INTERVAL = 15 * 60 * 1000; // 15 min

async function backgroundSyncAll() {
  const usersWithToken = await queryAll<{ user_id: number; value: string }>(
    "SELECT user_id, value FROM settings WHERE key = 'todoist_access_token'"
  );

  for (const row of usersWithToken) {
    try {
      const token = row.value;
      const userId = row.user_id;

      const todoistTasks: any[] = await todoistFetch(token, 'tasks');
      if (!todoistTasks) continue;

      let pulled = 0;
      for (const tt of todoistTasks) {
        if (tt.is_completed) continue;
        const existingLink = await getUserSetting(userId, `todoist_task_${tt.id}`);
        if (existingLink) continue; // already synced

        const priority = Math.min(5, Math.max(1, 5 - (tt.priority - 1)));
        const inserted = await queryOne<{ id: number }>(
          'INSERT INTO tasks (title, description, status, priority, due_date, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
          [tt.content, tt.description || '', 'todo', priority, tt.deadline?.date || tt.due?.date || null, userId]
        );
        if (inserted) {
          await setUserSetting(userId, `todoist_task_${tt.id}`, String(inserted.id));
          await setUserSetting(userId, `clarity_task_todoist_${inserted.id}`, tt.id);
          pulled++;
        }
      }

      // Close completed tasks in Todoist
      const doneTasks = await queryAll<{ id: number }>(
        "SELECT id FROM tasks WHERE user_id = $1 AND status = 'done' AND archived = 0",
        [userId]
      );
      const todoistOpenIds = new Set(todoistTasks.filter((t: any) => !t.is_completed).map((t: any) => String(t.id)));
      let pushed = 0;

      for (const ct of doneTasks) {
        const todoistId = await getUserSetting(userId, `clarity_task_todoist_${ct.id}`);
        if (!todoistId || !todoistOpenIds.has(todoistId)) continue;
        try { await todoistFetch(token, `tasks/${todoistId}/close`, { method: 'POST' }); pushed++; } catch {}
      }

      if (pulled > 0 || pushed > 0) {
        console.log(`[todoist-bg-sync] user ${userId}: ↓${pulled} ↑${pushed}`);
      }
    } catch (err) {
      console.error(`[todoist-bg-sync] user ${row.user_id} error:`, err);
    }
  }
}

export function startTodoistBackgroundSync() {
  console.log(`[todoist-bg-sync] every ${SYNC_INTERVAL / 60000} min`);
  setTimeout(() => backgroundSyncAll().catch(console.error), 60_000);
  setInterval(() => backgroundSyncAll().catch(console.error), SYNC_INTERVAL);
}
