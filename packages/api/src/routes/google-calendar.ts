import { Router, Request, Response } from 'express';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';
import { config } from '../config';
import { moscowDateString } from '../utils/time';

export const googleCalendarRouter = Router();

// Google Calendar OAuth flow
// Step 1: User visits /google-calendar/auth → redirects to Google
// Step 2: Google redirects back to /google-calendar/callback with code
// Step 3: We exchange code for tokens and store them

const SCOPES = 'https://www.googleapis.com/auth/calendar';

googleCalendarRouter.get('/auth', (_req: Request, res: Response) => {
  const clientId = config.googleClientId;
  if (!clientId) { res.status(400).json(fail('GOOGLE_CLIENT_ID not configured')); return; }

  const redirectUri = `${config.webappUrl}/v1/google-calendar/callback`;
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(SCOPES)}&access_type=offline&prompt=consent`;
  res.redirect(url);
});

googleCalendarRouter.get('/callback', async (req: Request, res: Response) => {
  const code = req.query['code'] as string;
  if (!code) { res.status(400).json(fail('No code')); return; }

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

    // Store tokens
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('google_access_token', ?)").run(tokens.access_token);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('google_refresh_token', ?)").run(tokens.refresh_token || '');
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('google_token_expiry', ?)").run(String(Date.now() + (tokens.expires_in || 3600) * 1000));

    res.send('<html><body><h2>Google Calendar подключён!</h2><p>Можете закрыть эту вкладку.</p><script>setTimeout(()=>window.close(),2000)</script></body></html>');
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'OAuth error'));
  }
});

// Helper: get valid access token (refresh if needed)
async function getAccessToken(): Promise<string | null> {
  const db = getDb();
  const token = db.prepare("SELECT value FROM settings WHERE key = 'google_access_token'").get() as { value: string } | undefined;
  const expiry = db.prepare("SELECT value FROM settings WHERE key = 'google_token_expiry'").get() as { value: string } | undefined;
  const refresh = db.prepare("SELECT value FROM settings WHERE key = 'google_refresh_token'").get() as { value: string } | undefined;

  if (!token?.value) return null;

  // Check if expired
  if (expiry && Number(expiry.value) < Date.now() && refresh?.value) {
    // Refresh token
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.googleClientId,
          client_secret: config.googleClientSecret,
          refresh_token: refresh.value,
          grant_type: 'refresh_token',
        }),
      });
      const data = await res.json();
      if (data.access_token) {
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('google_access_token', ?)").run(data.access_token);
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('google_token_expiry', ?)").run(String(Date.now() + (data.expires_in || 3600) * 1000));
        return data.access_token;
      }
    } catch {}
  }

  return token.value;
}

// GET /google-calendar/status — check if connected
googleCalendarRouter.get('/status', async (_req: Request, res: Response) => {
  const token = await getAccessToken();
  res.json(ok({ connected: !!token }));
});

// POST /google-calendar/sync — sync meetings to Google Calendar
googleCalendarRouter.post('/sync', async (_req: Request, res: Response) => {
  const token = await getAccessToken();
  if (!token) { res.status(401).json(fail('Google Calendar не подключён. Перейдите на /v1/google-calendar/auth')); return; }

  try {
    const db = getDb();
    const today = moscowDateString();
    const meetings = db.prepare("SELECT id, title, date FROM meetings WHERE date >= ? ORDER BY date LIMIT 50").all(today) as Array<{ id: number; title: string; date: string }>;

    let synced = 0;
    for (const m of meetings) {
      // Check if already synced
      const existing = db.prepare("SELECT value FROM settings WHERE key = ?").get(`gcal_event_${m.id}`) as { value: string } | undefined;
      if (existing) continue;

      // Create event in Google Calendar
      const event = {
        summary: m.title,
        start: { date: m.date },
        end: { date: m.date },
      };

      const gcRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      });

      if (gcRes.ok) {
        const gcEvent = await gcRes.json();
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(`gcal_event_${m.id}`, gcEvent.id);
        synced++;
      }
    }

    res.json(ok({ synced, total: meetings.length }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Sync error'));
  }
});

// GET /google-calendar/events — list events from Google Calendar
googleCalendarRouter.get('/events', async (_req: Request, res: Response) => {
  const token = await getAccessToken();
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
