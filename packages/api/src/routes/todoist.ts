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
