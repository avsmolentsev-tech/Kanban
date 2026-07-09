import { lookup } from 'dns/promises';
import { isIP } from 'net';

/** True if an IPv4/IPv6 address is private, loopback, link-local, or otherwise internal. */
export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some(n => Number.isNaN(n))) return true;
    const [a, b] = p as [number, number, number, number];
    if (a === 10) return true;                       // 10.0.0.0/8
    if (a === 127) return true;                      // loopback
    if (a === 0) return true;                        // 0.0.0.0/8
    if (a === 169 && b === 254) return true;         // link-local (cloud metadata 169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true;// 172.16.0.0/12
    if (a === 192 && b === 168) return true;         // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true;// CGNAT 100.64.0.0/10
    if (a >= 224) return true;                       // multicast / reserved
    return false;
  }
  // IPv6
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;          // loopback / unspecified
  if (lower.startsWith('fe80')) return true;                  // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
  if (lower.startsWith('::ffff:')) return isPrivateIp(lower.slice(7)); // IPv4-mapped
  return false;
}

/**
 * Validate a user-supplied URL for outbound fetch. Allows only http/https to a
 * public host. Throws on any private/internal target — blocks SSRF to loopback,
 * RFC1918, link-local (cloud metadata), etc.
 * Returns the parsed URL when safe.
 */
export async function assertSafePublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Некорректный URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Разрешены только http/https URL');
  }
  const host = url.hostname;
  // Literal IP in the URL
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error('Доступ к внутренним адресам запрещён');
    return url;
  }
  // Resolve the hostname and reject if ANY resolved address is internal
  let addrs: Array<{ address: string }>;
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new Error('Не удалось разрешить хост');
  }
  if (addrs.length === 0 || addrs.some(a => isPrivateIp(a.address))) {
    throw new Error('Доступ к внутренним адресам запрещён');
  }
  return url;
}
