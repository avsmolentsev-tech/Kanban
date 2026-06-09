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
