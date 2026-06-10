import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import { queryAll, queryOne, execute } from '../db/db';
import { ok, fail } from '@pis/shared';
import { config } from '../config';
import { moscowDateString } from '../utils/time';
import type { AuthRequest } from '../middleware/auth';
import { getUserId } from '../middleware/user-scope';

export const googleCalendarRouter = Router();

const SCOPES = 'https://www.googleapis.com/auth/calendar';

// Per-user settings helpers
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

// Step 1: Redirect to Google OAuth — user_id passed via query param or JWT
googleCalendarRouter.get('/auth', (req: AuthRequest, res: Response) => {
  const clientId = config.googleClientId;
  if (!clientId) { res.status(400).json(fail('GOOGLE_CLIENT_ID not configured')); return; }

  // Get user_id from JWT or query param
  const userId = getUserId(req) || (req.query['uid'] ? Number(req.query['uid']) : null);
  if (!userId) { res.status(401).json(fail('Not authenticated. Add ?uid=YOUR_USER_ID')); return; }

  const redirectUri = `${config.webappUrl}/v1/google-calendar/callback`;
  const state = jwt.sign({ userId }, config.jwtSecret, { expiresIn: '10m' });
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(SCOPES)}&access_type=offline&prompt=consent&state=${encodeURIComponent(state)}`;
  res.redirect(url);
});

// Step 2: Google redirects back with code + state(user_id)
googleCalendarRouter.get('/callback', async (req: AuthRequest, res: Response) => {
  const code = req.query['code'] as string;
  const state = req.query['state'] as string;
  if (!code) { res.status(400).json(fail('No code')); return; }
  if (!state) { res.status(400).json(fail('No state')); return; }

  let userId: number;
  try {
    const payload = jwt.verify(state, config.jwtSecret) as { userId: number };
    userId = payload.userId;
  } catch {
    res.status(403).json(fail('Invalid or expired OAuth state'));
    return;
  }
  if (!userId) { res.status(401).json(fail('No user')); return; }

  try {
    const redirectUri = `${config.webappUrl}/v1/google-calendar/callback`;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();

    if (tokens.error) {
      res.status(400).json(fail(tokens.error_description || tokens.error));
      return;
    }

    // Store tokens per user
    await setUserSetting(userId, 'google_access_token', tokens.access_token);
    await setUserSetting(userId, 'google_refresh_token', tokens.refresh_token || '');
    await setUserSetting(userId, 'google_token_expiry', String(Date.now() + (tokens.expires_in || 3600) * 1000));

    res.send('<html><body><h2>Google Calendar подключён!</h2><p>Можете закрыть эту вкладку.</p><script>setTimeout(()=>window.close(),2000)</script></body></html>');
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'OAuth error'));
  }
});

// Helper: get valid access token for a specific user
async function getAccessTokenForUser(userId: number): Promise<string | null> {
  const token = await getUserSetting(userId, 'google_access_token');
  const expiry = await getUserSetting(userId, 'google_token_expiry');
  const refresh = await getUserSetting(userId, 'google_refresh_token');

  if (!token) return null;

  // Check if expired
  if (expiry && Number(expiry) < Date.now() && refresh) {
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.googleClientId,
          client_secret: config.googleClientSecret,
          refresh_token: refresh,
          grant_type: 'refresh_token',
        }),
      });
      const data = await res.json();
      if (data.access_token) {
        await setUserSetting(userId, 'google_access_token', data.access_token);
        await setUserSetting(userId, 'google_token_expiry', String(Date.now() + (data.expires_in || 3600) * 1000));
        return data.access_token;
      }
    } catch {}
  }

  return token;
}

// GET /google-calendar/status
googleCalendarRouter.get('/status', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) { res.json(ok({ connected: false })); return; }
  const token = await getAccessTokenForUser(userId);
  res.json(ok({ connected: !!token }));
});

// POST /google-calendar/disconnect
googleCalendarRouter.post('/disconnect', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json(fail('Not authenticated')); return; }
  await execute(
    "DELETE FROM settings WHERE user_id = $1 AND key IN ('google_access_token', 'google_refresh_token', 'google_token_expiry')",
    [userId]
  );
  res.json(ok({ disconnected: true }));
});

// POST /google-calendar/sync — sync user's meetings to their Google Calendar
googleCalendarRouter.post('/sync', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json(fail('Not authenticated')); return; }
  const token = await getAccessTokenForUser(userId);
  if (!token) { res.status(400).json(fail('Google Calendar не подключён')); return; }

  try {
    const today = moscowDateString();
    const meetings = await queryAll<{ id: number; title: string; date: string }>(
      'SELECT id, title, date FROM meetings WHERE date >= $1 AND user_id = $2 ORDER BY date LIMIT 50',
      [today, userId]
    );

    let synced = 0;
    for (const m of meetings) {
      const existing = await getUserSetting(userId, `gcal_event_${m.id}`);
      if (existing) continue;

      const event = {
        summary: m.title,
        start: { date: m.date },
        end: { date: m.date },
      };

      const gcRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });

      if (gcRes.ok) {
        const gcEvent = await gcRes.json();
        await setUserSetting(userId, `gcal_event_${m.id}`, gcEvent.id);
        synced++;
      }
    }

    res.json(ok({ synced, total: meetings.length }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Sync error'));
  }
});

// POST /google-calendar/events — create a new event
googleCalendarRouter.post('/events', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json(fail('Not authenticated')); return; }
  const token = await getAccessTokenForUser(userId);
  if (!token) { res.status(400).json(fail('Google Calendar не подключён')); return; }

  try {
    const { summary, date, startTime, endTime, description } = req.body as {
      summary: string; date: string; startTime?: string; endTime?: string; description?: string;
    };
    if (!summary || !date) { res.status(400).json(fail('summary and date are required')); return; }

    const event: any = { summary };
    if (description) event.description = description;

    if (startTime && endTime) {
      event.start = { dateTime: `${date}T${startTime}:00`, timeZone: 'Europe/Moscow' };
      event.end = { dateTime: `${date}T${endTime}:00`, timeZone: 'Europe/Moscow' };
    } else {
      event.start = { date };
      event.end = { date };
    }

    const gcRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    const gcEvent = await gcRes.json();
    if (!gcRes.ok) { res.status(gcRes.status).json(fail(gcEvent.error?.message || 'Create failed')); return; }
    res.json(ok(gcEvent));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Create error'));
  }
});

// PATCH /google-calendar/events/:eventId — update an event
googleCalendarRouter.patch('/events/:eventId', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json(fail('Not authenticated')); return; }
  const token = await getAccessTokenForUser(userId);
  if (!token) { res.status(400).json(fail('Google Calendar не подключён')); return; }

  try {
    const { eventId } = req.params;
    const { summary, date, startTime, endTime, description } = req.body as {
      summary?: string; date?: string; startTime?: string; endTime?: string; description?: string;
    };

    const patch: any = {};
    if (summary !== undefined) patch.summary = summary;
    if (description !== undefined) patch.description = description;

    if (date && startTime && endTime) {
      patch.start = { dateTime: `${date}T${startTime}:00`, timeZone: 'Europe/Moscow' };
      patch.end = { dateTime: `${date}T${endTime}:00`, timeZone: 'Europe/Moscow' };
    } else if (date) {
      patch.start = { date };
      patch.end = { date };
    }

    const gcRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const gcEvent = await gcRes.json();
    if (!gcRes.ok) { res.status(gcRes.status).json(fail(gcEvent.error?.message || 'Update failed')); return; }
    res.json(ok(gcEvent));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Update error'));
  }
});

// DELETE /google-calendar/events/:eventId — delete an event
googleCalendarRouter.delete('/events/:eventId', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json(fail('Not authenticated')); return; }
  const token = await getAccessTokenForUser(userId);
  if (!token) { res.status(400).json(fail('Google Calendar не подключён')); return; }

  try {
    const { eventId } = req.params;
    const gcRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!gcRes.ok && gcRes.status !== 204) {
      const body = await gcRes.json().catch(() => ({}));
      res.status(gcRes.status).json(fail((body as any).error?.message || 'Delete failed'));
      return;
    }
    res.json(ok({ deleted: true }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Delete error'));
  }
});

// GET /google-calendar/events — list events from user's Google Calendar
googleCalendarRouter.get('/events', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) { res.json(ok([])); return; }
  const token = await getAccessTokenForUser(userId);
  if (!token) { res.json(ok([])); return; }

  try {
    const today = new Date().toISOString();
    const gcRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${today}&maxResults=20&singleEvents=true&orderBy=startTime`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await gcRes.json();
    res.json(ok(data.items || []));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Fetch error'));
  }
});
