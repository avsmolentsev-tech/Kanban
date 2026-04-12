import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';
import { config } from '../config';
import { moscowDateString } from '../utils/time';
import type { AuthRequest } from '../middleware/auth';
import { getUserId } from '../middleware/user-scope';

export const googleCalendarRouter = Router();

const SCOPES = 'https://www.googleapis.com/auth/calendar';

// Per-user settings helpers
function getUserSetting(userId: number, key: string): string | null {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = ? AND user_id = ?").get(key, userId) as { value: string } | undefined;
  return row?.value ?? null;
}

function setUserSetting(userId: number, key: string, value: string): void {
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO settings (key, value, user_id) VALUES (?, ?, ?)").run(key, value, userId);
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
    setUserSetting(userId, 'google_access_token', tokens.access_token);
    setUserSetting(userId, 'google_refresh_token', tokens.refresh_token || '');
    setUserSetting(userId, 'google_token_expiry', String(Date.now() + (tokens.expires_in || 3600) * 1000));

    res.send('<html><body><h2>Google Calendar подключён!</h2><p>Можете закрыть эту вкладку.</p><script>setTimeout(()=>window.close(),2000)</script></body></html>');
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'OAuth error'));
  }
});

// Helper: get valid access token for a specific user
async function getAccessTokenForUser(userId: number): Promise<string | null> {
  const token = getUserSetting(userId, 'google_access_token');
  const expiry = getUserSetting(userId, 'google_token_expiry');
  const refresh = getUserSetting(userId, 'google_refresh_token');

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
        setUserSetting(userId, 'google_access_token', data.access_token);
        setUserSetting(userId, 'google_token_expiry', String(Date.now() + (data.expires_in || 3600) * 1000));
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
googleCalendarRouter.post('/disconnect', (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json(fail('Not authenticated')); return; }
  const db = getDb();
  db.prepare("DELETE FROM settings WHERE user_id = ? AND key IN ('google_access_token', 'google_refresh_token', 'google_token_expiry')").run(userId);
  res.json(ok({ disconnected: true }));
});

// POST /google-calendar/sync — sync user's meetings to their Google Calendar
googleCalendarRouter.post('/sync', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json(fail('Not authenticated')); return; }
  const token = await getAccessTokenForUser(userId);
  if (!token) { res.status(400).json(fail('Google Calendar не подключён')); return; }

  try {
    const db = getDb();
    const today = moscowDateString();
    const meetings = db.prepare("SELECT id, title, date FROM meetings WHERE date >= ? AND user_id = ? ORDER BY date LIMIT 50").all(today, userId) as Array<{ id: number; title: string; date: string }>;

    let synced = 0;
    for (const m of meetings) {
      const existing = getUserSetting(userId, `gcal_event_${m.id}`);
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
        setUserSetting(userId, `gcal_event_${m.id}`, gcEvent.id);
        synced++;
      }
    }

    res.json(ok({ synced, total: meetings.length }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Sync error'));
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
