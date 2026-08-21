/**
 * Регресс на «❌ Ошибка: fetch failed» при отправке аудио в бота.
 *
 * Замер на боевом сервере 20.08.2026: 2 из 30 запросов к api.telegram.org
 * отваливаются с ETIMEDOUT (~7%). Скачивание файла в downloadTelegramFile
 * делалось одной попыткой голым fetch — без таймаута, без ретрая и без
 * проверки response.ok, — поэтому разовый сетевой чих превращался в
 * необратимую ошибку пользователю. Сообщение при этом было бесполезным:
 * undici кладёт причину в err.cause, а обработчик печатал только err.message.
 */
import * as http from 'http';
import type { AddressInfo } from 'net';
import { fetchBufferWithRetry, describeFetchError, retryAsync, redactUrl } from '../utils/fetch-retry';

const BOT_URL = 'https://api.telegram.org/file/bot8787723406:AAHxDummySecret_-123/music/file_1.mp3';

describe('redactUrl', () => {
  test('токен бота не утекает — он есть в ссылке на файл Telegram', () => {
    const out = redactUrl(BOT_URL);
    expect(out).not.toContain('AAHxDummySecret_-123');
    expect(out).not.toContain('8787723406');
    expect(out).toContain('file_1.mp3');
  });

  test('значения query-параметров глушатся', () => {
    const out = redactUrl('https://example.com/x?api_key=secret123&id=7');
    expect(out).not.toContain('secret123');
    expect(out).toContain('api_key=');
  });

  test('логин с паролем в URL вычищается', () => {
    const out = redactUrl('https://user:hunter2@example.com/x');
    expect(out).not.toContain('hunter2');
  });

  test('строка, не являющаяся URL, всё равно чистится от токена', () => {
    expect(redactUrl('дичь bot8787723406:AAHxDummySecret_-123 дичь')).not.toContain('AAHxDummySecret');
  });

  test('обычный URL не портится', () => {
    expect(redactUrl('https://example.com/a/b.mp3')).toBe('https://example.com/a/b.mp3');
  });
});

describe('fetchBufferWithRetry', () => {
  let server: http.Server;
  let url: string;
  let requests = 0;
  /** Что сервер должен сделать с очередным запросом. Сдвигается по одному за запрос. */
  let script: Array<'ok' | 'drop' | 500 | 404 | 429> = [];

  beforeAll((done) => {
    server = http.createServer((req, res) => {
      requests++;
      const action = script.shift() ?? 'ok';
      if (action === 'drop') {
        // рвём соединение — так выглядит транспортный сбой, тот же класс, что ETIMEDOUT
        req.socket.destroy();
        return;
      }
      if (action === 'ok') {
        res.writeHead(200, { 'content-type': 'audio/mpeg' });
        res.end(Buffer.from([1, 2, 3, 4]));
        return;
      }
      res.writeHead(action);
      res.end('boom');
    });
    server.listen(0, '127.0.0.1', () => {
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/file`;
      done();
    });
  });

  afterAll((done) => { server.close(() => done()); });

  beforeEach(() => { requests = 0; script = []; });

  test('транзиентный обрыв переживается ретраем', async () => {
    script = ['drop', 'ok'];
    const buf = await fetchBufferWithRetry(url, { attempts: 3, backoffMs: 0 });
    expect(Buffer.from([1, 2, 3, 4]).equals(buf)).toBe(true);
    expect(requests).toBe(2);
  });

  test('два обрыва подряд тоже переживаются', async () => {
    script = ['drop', 'drop', 'ok'];
    const buf = await fetchBufferWithRetry(url, { attempts: 3, backoffMs: 0 });
    expect(buf.length).toBe(4);
    expect(requests).toBe(3);
  });

  test('когда попытки исчерпаны — в сообщении есть причина, а не голое fetch failed', async () => {
    script = ['drop', 'drop', 'drop'];
    await expect(fetchBufferWithRetry(url, { attempts: 3, backoffMs: 0 }))
      .rejects.toThrow(/попыт/i);

    // скрипт надо зарядить заново: пустой скрипт означает успешный ответ
    script = ['drop'];
    const err = await fetchBufferWithRetry(url, { attempts: 1, backoffMs: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    // главное: сообщение не должно быть бесполезным «fetch failed»
    expect(err.message).not.toBe('fetch failed');
    expect(err.message).toMatch(/попытку/);
  });

  test('5xx считается временным и ретраится', async () => {
    script = [500, 'ok'];
    const buf = await fetchBufferWithRetry(url, { attempts: 3, backoffMs: 0 });
    expect(buf.length).toBe(4);
    expect(requests).toBe(2);
  });

  test('429 ретраится', async () => {
    script = [429, 'ok'];
    await fetchBufferWithRetry(url, { attempts: 3, backoffMs: 0 });
    expect(requests).toBe(2);
  });

  test('404 постоянный — ретраить нельзя, падаем сразу и со статусом', async () => {
    script = [404, 'ok', 'ok'];
    await expect(fetchBufferWithRetry(url, { attempts: 3, backoffMs: 0 }))
      .rejects.toThrow(/404/);
    expect(requests).toBe(1);
  });

  test('не-ok ответ не превращается в тело файла', async () => {
    // раньше HTML/JSON ошибки молча уезжал в буфер и падал уже в ffmpeg
    script = [404];
    const err = await fetchBufferWithRetry(url, { attempts: 1, backoffMs: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
  });

  test('onRetry зовётся на каждую неудачную попытку', async () => {
    script = ['drop', 500, 'ok'];
    const seen: number[] = [];
    await fetchBufferWithRetry(url, { attempts: 3, backoffMs: 0, onRetry: (n) => seen.push(n) });
    expect(seen).toEqual([1, 2]);
  });

  test('закрытый порт даёт осмысленную причину, а не голое fetch failed', async () => {
    // Берём заведомо свободный порт: поднимаем сервер, узнаём порт, гасим его.
    // Порты вроде 1 не годятся — undici блокирует их по спецификации («bad port»),
    // и это уже не отказ в соединении.
    const dead = http.createServer();
    const deadPort = await new Promise<number>((resolve) => {
      dead.listen(0, '127.0.0.1', () => resolve((dead.address() as AddressInfo).port));
    });
    await new Promise<void>((resolve) => dead.close(() => resolve()));

    const err = await fetchBufferWithRetry(`http://127.0.0.1:${deadPort}/nope`, { attempts: 1, backoffMs: 0 })
      .catch((e) => e);
    expect(err.message).toMatch(/ECONNREFUSED/);
  });
});

describe('retryAsync', () => {
  test('повторяет до первого успеха', async () => {
    let calls = 0;
    const result = await retryAsync(async () => {
      calls++;
      if (calls < 3) throw new Error('сеть моргнула');
      return 'готово';
    }, { attempts: 3, backoffMs: 0 });
    expect(result).toBe('готово');
    expect(calls).toBe(3);
  });

  test('исходная ошибка уходит наружу как есть, с cause', async () => {
    const cause = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });
    const original = new TypeError('fetch failed', { cause });
    const err = await retryAsync(async () => { throw original; }, { attempts: 2, backoffMs: 0 })
      .catch((e) => e);
    expect(err).toBe(original);
    expect(describeFetchError(err)).toMatch(/ETIMEDOUT/);
  });

  test('постоянную ошибку не повторяет', async () => {
    let calls = 0;
    await expect(retryAsync(async () => {
      calls++;
      throw Object.assign(new Error('нет прав'), { permanent: true });
    }, {
      attempts: 5,
      backoffMs: 0,
      isPermanent: (e) => (e as { permanent?: boolean }).permanent === true,
    })).rejects.toThrow(/нет прав/);
    expect(calls).toBe(1);
  });
});

describe('describeFetchError', () => {
  test('разворачивает цепочку cause, которую глотал обработчик', () => {
    const cause = Object.assign(new Error('connect ETIMEDOUT 149.154.166.110:443'), { code: 'ETIMEDOUT' });
    const err = new TypeError('fetch failed', { cause });
    const text = describeFetchError(err);
    expect(text).toMatch(/ETIMEDOUT/);
  });

  test('обычная ошибка без cause не ломается', () => {
    expect(describeFetchError(new Error('просто ошибка'))).toMatch(/просто ошибка/);
  });

  test('не-Error не ломает', () => {
    expect(typeof describeFetchError('строка')).toBe('string');
  });
});
