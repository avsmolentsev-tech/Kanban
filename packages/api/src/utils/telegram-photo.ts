/**
 * Resolve a public Telegram user's profile photo from their @username.
 * The Bot API can't do this by username, but the public t.me/<username> page
 * exposes the avatar as og:image (hosted on Telegram's CDN). Works only for
 * public accounts with an open photo; returns null otherwise (→ initials).
 */
export async function fetchTelegramPhoto(usernameRaw: string): Promise<string | null> {
  const u = (usernameRaw || '')
    .trim()
    .replace(/^https?:\/\/t\.me\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0] ?? '';
  if (!u || !/^[A-Za-z0-9_]{3,32}$/.test(u)) return null;
  try {
    const res = await fetch(`https://t.me/${u}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ClaritySpace/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/<meta property="og:image" content="([^"]+)"/i);
    const img = m?.[1];
    // Accept only real profile photos on Telegram's CDN, not the default logo.
    if (img && /telesco\.pe|cdn\d*\.telegram/i.test(img)) return img;
    return null;
  } catch {
    return null;
  }
}
