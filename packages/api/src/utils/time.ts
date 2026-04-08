/** Moscow time helpers (UTC+3, no DST since 2014) */

export function moscowNow(): Date {
  const now = new Date();
  // UTC + 3 hours
  return new Date(now.getTime() + 3 * 60 * 60 * 1000);
}

export function moscowDateString(): string {
  return moscowNow().toISOString().split('T')[0]!;
}

export function moscowDateTimeString(): string {
  const d = moscowNow();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} МСК`;
}
