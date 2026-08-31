/**
 * Устойчивое скачивание по HTTP с ретраем.
 *
 * Зачем: исходящая сеть боевого сервера до api.telegram.org нестабильна —
 * замер 20.08.2026 дал 2 провала из 30 запросов (ETIMEDOUT, ~7%). Скачивание
 * файла из Telegram делалось одной попыткой голым fetch, поэтому разовый чих
 * сети превращался в необратимую «❌ Ошибка: fetch failed» пользователю.
 *
 * Плюс две ловушки нативного fetch, из-за которых сообщение было бесполезным:
 *   1. undici кладёт настоящую причину в `err.cause`, а `err.message` у него
 *      всегда голое «fetch failed» — печатать надо цепочку, а не message.
 *   2. `fetch` не бросает на 4xx/5xx. Без проверки `response.ok` тело ошибки
 *      (HTML или JSON) молча уезжало в буфер вместо аудио и падало уже
 *      в ffmpeg — с совершенно посторонней диагностикой.
 */

// `| undefined` в каждом поле — из-за exactOptionalPropertyTypes в tsconfig:
// без него нельзя пробросить опцию дальше как `backoffMs: opts.backoffMs`.
export interface RetryOptions {
  /** Сколько всего попыток, включая первую. */
  attempts?: number | undefined;
  /** База экспоненциальной паузы: backoffMs * 2^(номер попытки - 1). */
  backoffMs?: number | undefined;
  /** Зовётся после каждой неудачной попытки, если попытки ещё остались. */
  onRetry?: ((attempt: number, err: unknown) => void) | undefined;
  /** Ошибки, которые повтором не исправить: сразу наружу. */
  isPermanent?: ((err: unknown) => boolean) | undefined;
}

export interface FetchRetryOptions extends RetryOptions {
  /** Потолок на одну попытку целиком, вместе с чтением тела. */
  timeoutMs?: number | undefined;
}

/**
 * Разворачивает цепочку `cause` в читаемую строку.
 *
 * Именно её надо показывать вместо `err.message`: у undici сообщение верхнего
 * уровня всегда «fetch failed», а код (ETIMEDOUT, ECONNREFUSED, ENOTFOUND,
 * UND_ERR_HEADERS_TIMEOUT) лежит уровнем ниже.
 */
/**
 * Ошибку опознаём по форме, а не через `instanceof Error`.
 *
 * undici создаёт `cause` во внутреннем realm, и strict-проверка на нём
 * не срабатывает — цепочка обрывалась на верхнем «fetch failed», то есть
 * ровно на том, ради чего эта функция и нужна.
 */
function asErrorLike(value: unknown): { name?: string; message: string; code?: string; cause?: unknown } | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  return typeof v['message'] === 'string'
    ? (v as unknown as { name?: string; message: string; code?: string; cause?: unknown })
    : null;
}

export function describeFetchError(err: unknown): string {
  const top = asErrorLike(err);
  if (!top) return String(err);

  const parts: string[] = [];
  const seen = new Set<unknown>();
  let cur: unknown = err;

  // Ограничение на глубину — на случай закольцованного cause.
  while (parts.length < 5) {
    const e = asErrorLike(cur);
    if (!e || seen.has(cur)) break;
    seen.add(cur);
    const name = e.name && e.name !== 'Error' ? `${e.name}: ` : '';
    parts.push(`${name}${e.message}${e.code ? ` [${e.code}]` : ''}`);
    cur = e.cause;
  }

  return parts.join(' ← ');
}

/**
 * Убирает из URL секреты перед попаданием в лог или в сообщение пользователю.
 *
 * Ссылка на файл Telegram выглядит как
 * `https://api.telegram.org/file/bot<id>:<секрет>/music/file_1.mp3` — то есть
 * содержит токен бота целиком. Без чистки он уезжал бы прямо в чат вместе
 * с текстом ошибки. Заодно вычищаем userinfo и значения query-параметров,
 * где обычно ездят ключи API.
 */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.username || u.password) { u.username = ''; u.password = ''; }
    u.pathname = u.pathname.replace(/\/bot\d+:[A-Za-z0-9_-]+/g, '/bot<TOKEN>');
    for (const key of [...u.searchParams.keys()]) u.searchParams.set(key, '<REDACTED>');
    return u.toString();
  } catch {
    // не-URL: на всякий случай глушим то, что похоже на токен бота
    return raw.replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot<TOKEN>');
  }
}

/** Ошибка HTTP-статуса. Флаг говорит, есть ли смысл повторять запрос. */
class HttpStatusError extends Error {
  constructor(readonly status: number, readonly transient: boolean, url: string) {
    super(`HTTP ${status} от ${redactUrl(url)}`);
    this.name = 'HttpStatusError';
  }
}

/**
 * 5xx и 429 — временные, их повторяем. Остальные 4xx означают, что запрос
 * не станет валиднее от повтора (протухшая ссылка на файл, неверный токен),
 * и ретрай только тянет время и жжёт лимиты.
 */
function isTransientStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

const sleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

/**
 * Повторяет асинхронную операцию с экспоненциальной паузой.
 *
 * Ошибка наружу уходит исходным объектом, не пересозданной: `new Error(String(err))`
 * затирает `cause` и возвращает диагностику к бесполезному «fetch failed».
 */
export async function retryAsync<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const backoffMs = opts.backoffMs ?? 300;
  let lastErr: unknown = new Error('попыток не было');

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (opts.isPermanent?.(err)) throw err;
      lastErr = err;
      if (attempt < attempts) {
        opts.onRetry?.(attempt, err);
        await sleep(backoffMs * 2 ** (attempt - 1));
      }
    }
  }

  throw lastErr;
}

/**
 * Скачивает URL в Buffer, переживая транзиентные сбои сети.
 *
 * Бросает, если попытки исчерпаны или ответ постоянно-ошибочный. В сообщении
 * всегда есть число попыток и развёрнутая причина.
 */
export async function fetchBufferWithRetry(url: string, opts: FetchRetryOptions = {}): Promise<Buffer> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const timeoutMs = opts.timeoutMs ?? 60_000;

  try {
    return await retryAsync(async () => {
      // Свежий сигнал на каждую попытку: истёкший AbortSignal переиспользовать нельзя.
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) {
        // Тело ошибки не нужно, но соединение надо освободить.
        await res.arrayBuffer().catch(() => undefined);
        throw new HttpStatusError(res.status, isTransientStatus(res.status), url);
      }
      return Buffer.from(await res.arrayBuffer());
    }, {
      attempts,
      backoffMs: opts.backoffMs,
      onRetry: opts.onRetry,
      isPermanent: (err) => err instanceof HttpStatusError && !err.transient,
    });
  } catch (err) {
    // Постоянный статус говорит сам за себя — не заворачиваем в «за N попыток».
    if (err instanceof HttpStatusError && !err.transient) throw err;
    const word = attempts === 1 ? 'попытку' : 'попыток';
    throw new Error(
      `не удалось скачать ${redactUrl(url)} за ${attempts} ${word}: ${describeFetchError(err)}`,
      { cause: err },
    );
  }
}
