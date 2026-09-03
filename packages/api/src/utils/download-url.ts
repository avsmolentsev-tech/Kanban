/**
 * Приведение «ссылки на просмотр» к прямой ссылке на скачивание.
 *
 * Бот советует пользователю прислать `/transcribe <ссылка>` для файлов тяжелее
 * 20 МБ (Telegram не отдаёт ботам больше). Но ссылка, которую даёт кнопка
 * «Поделиться» в Google Drive, выглядит как
 *   https://drive.google.com/file/d/<ID>/view?usp=drivesdk
 * и ведёт на HTML-страницу просмотра, а не на файл. Скачивание такой ссылки
 * возвращает 200 и страницу, проверка `res.ok` её пропускает, HTML сохраняется
 * под видом аудио (~100 КБ, то есть «0 MB» после округления) и уезжает в whisper,
 * который не находит там речи. Пользователь видел «Скачано (0 MB)» и следом
 * «Не удалось распознать речь», и рабочего пути для большого файла у него не было.
 */

/** Достаёт идентификатор файла Google Drive из любой из принятых форм ссылки. */
function googleDriveId(u: URL): string | null {
  // /file/d/<ID>/view, /file/d/<ID>/edit, /file/d/<ID>
  const m = u.pathname.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
  if (m) return m[1] ?? null;
  // /open?id=<ID>, /uc?id=<ID>
  const id = u.searchParams.get('id');
  return id && /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
}

/**
 * Синхронное переписывание ссылки. Ссылки, которые не умеем, возвращаются как есть —
 * прямая ссылка на mp3 должна работать без всякой магии.
 */
export function directDownloadUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw; // не URL — пусть дальше падает предсказуемо, а не здесь
  }

  if (u.hostname === 'drive.google.com') {
    const id = googleDriveId(u);
    if (id) return `https://drive.google.com/uc?export=download&id=${id}`;
    return raw;
  }

  // У Dropbox dl=0 отдаёт страницу-обёртку, dl=1 — сам файл.
  if (u.hostname.endsWith('dropbox.com')) {
    u.searchParams.set('dl', '1');
    return u.toString();
  }

  return raw;
}

/** Публичная ссылка Яндекс.Диска — файл по ней достаётся только через API. */
export function isYandexDiskUrl(raw: string): boolean {
  try {
    const h = new URL(raw).hostname;
    return h === 'disk.yandex.ru' || h === 'disk.yandex.com' || h === 'yadi.sk';
  } catch {
    return false;
  }
}

type Fetcher = (url: string) => Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }>;

/**
 * Приводит ссылку к прямой. Для Яндекс.Диска нужен запрос к их публичному API —
 * поэтому функция асинхронная. Клиент передаётся параметром, чтобы логику
 * можно было проверить тестом, не ходя в сеть.
 */
export async function resolveDownloadUrl(raw: string, fetcher: Fetcher = fetch as unknown as Fetcher): Promise<string> {
  if (isYandexDiskUrl(raw)) {
    const api = 'https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=' +
      encodeURIComponent(raw);
    const res = await fetcher(api);
    if (!res.ok) {
      throw new Error(
        `Яндекс.Диск не отдал файл по этой ссылке (код ${res.status ?? '?'}). ` +
        'Проверь, что доступ публичный — «Поделиться» → «Доступ по ссылке».'
      );
    }
    const body = (await res.json()) as { href?: string };
    if (!body.href) throw new Error('Яндекс.Диск не вернул ссылку на скачивание');
    return body.href;
  }

  return directDownloadUrl(raw);
}

/**
 * Похоже ли скачанное на HTML-страницу.
 *
 * Смысл проверки — не пустить страницу («доступ закрыт», «подтвердите скачивание»,
 * страница просмотра) в транскрибацию, где она превращается в бессмысленное
 * «речь не распознана». Смотрим только начало буфера: у настоящего аудио там
 * сигнатура формата (ID3, MPEG-фрейм, OggS, RIFF), а не угловая скобка.
 */
export function looksLikeHtml(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  const head = buf.subarray(0, 512).toString('latin1').trim().toLowerCase();
  if (!head.startsWith('<')) return false;
  return head.includes('<html') || head.includes('<!doctype html');
}
