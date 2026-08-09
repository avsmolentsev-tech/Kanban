/**
 * Регресс на баг «музыка, музыка»: часовая запись теряла все сегменты с
 * `TypeError: fetch failed` (cause UND_ERR_HEADERS_TIMEOUT — 300 с у undici),
 * уезжала в фолбэк на whisper.cpp и превращалась в петлю-галлюцинацию.
 * Транспорт переведён на node:http, где скрытого таймаута заголовков нет.
 */
import * as http from 'http';
import type { AddressInfo } from 'net';
import { safeTmpName } from '../services/whisper-local.service';

describe('safeTmpName', () => {
  test.each([
    '../../../etc/cron.d/x',
    '/etc/passwd',
    '....//evil.sh',
    '..',
    '...',
    '',
  ])('%p не выводит за пределы каталога', (input) => {
    const path = require('path');
    const dir = '/tmp/work';
    const joined = path.join(dir, `svc-1-${safeTmpName(input)}`);
    expect(path.dirname(joined)).toBe(dir);
    expect(safeTmpName(input)).not.toContain('/');
  });

  test('обычное имя не портится', () => {
    expect(safeTmpName('meeting.mp3')).toBe('meeting.mp3');
    expect(safeTmpName('call-2026-08-09.m4a')).toBe('call-2026-08-09.m4a');
  });

  test('пустое имя даёт безопасный фолбэк', () => {
    expect(safeTmpName('')).toBe('audio');
    expect(safeTmpName('...')).toBe('audio');
  });
});

describe('транспорт до сервиса транскрибации', () => {
  let server: http.Server;
  let port: number;
  let received: { contentType: string; body: Buffer } | null = null;
  let delayMs = 0;
  let status = 200;
  let payload = JSON.stringify({ text: 'привет из сервиса' });

  beforeAll((done) => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        received = { contentType: String(req.headers['content-type'] ?? ''), body: Buffer.concat(chunks) };
        setTimeout(() => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(payload);
        }, delayMs);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port;
      done();
    });
  });

  afterAll((done) => { server.close(() => done()); });

  beforeEach(() => {
    received = null; delayMs = 0; status = 200;
    payload = JSON.stringify({ text: 'привет из сервиса' });
    process.env['TRANSCRIBE_SERVICE_URL'] = `http://127.0.0.1:${port}`;
    jest.resetModules();
  });

  /** Грузим модуль заново, чтобы он прочитал текущий TRANSCRIBE_SERVICE_URL. */
  const load = (): typeof import('../services/whisper-local.service') =>
    require('../services/whisper-local.service');

  test('короткое аудио уходит одним запросом и возвращает текст', async () => {
    const { transcribeViaService } = load();
    const text = await transcribeViaService(Buffer.alloc(2048, 3), 'meeting.mp3');
    expect(text).toBe('привет из сервиса');
  });

  test('тело собирается как валидный multipart с файлом и языком', async () => {
    const { transcribeViaService } = load();
    await transcribeViaService(Buffer.from('АУДИОДАННЫЕ'), 'meeting.mp3');

    expect(received!.contentType).toMatch(/^multipart\/form-data; boundary=----clarity[0-9a-f]{32}$/);
    const raw = received!.body.toString('utf-8');
    expect(raw).toContain('Content-Disposition: form-data; name="language"');
    expect(raw).toContain('\r\n\r\nru\r\n');
    expect(raw).toContain('name="file"; filename="meeting.mp3"');
    expect(raw).toContain('АУДИОДАННЫЕ');
    // закрывающая граница на месте — иначе сервис не разберёт тело
    expect(raw.trimEnd().endsWith('--')).toBe(true);
  });

  test('имя файла в multipart тоже обеззараживается', async () => {
    const { transcribeViaService } = load();
    await transcribeViaService(Buffer.alloc(64), '../../../etc/passwd');
    expect(received!.body.toString('utf-8')).toContain('filename="passwd"');
  });

  test('ответ не-2xx превращается в ошибку с телом', async () => {
    status = 503;
    payload = 'service overloaded';
    const { transcribeViaService } = load();
    await expect(transcribeViaService(Buffer.alloc(64), 'a.mp3')).rejects.toThrow(/503.*service overloaded/);
  });

  test('ожидание дольше 300 с не обрывается — это и был баг с undici', async () => {
    // 301 с реального ожидания в юнит-тесте гонять нельзя, поэтому проверяем
    // контракт: собственный таймаут запроса заведомо больше лимита undici.
    const src = require('fs').readFileSync(require.resolve('../services/whisper-local.service.ts'), 'utf-8');
    const m = src.match(/SEGMENT_TIMEOUT_MS\s*=\s*(\d+)\s*\*\s*60\s*\*\s*1000/);
    expect(m).toBeTruthy();
    expect(Number(m![1]) * 60 * 1000).toBeGreaterThan(300_000);
    // и сам fetch в горячем пути не используется — только node:http
    const hotPath = src.slice(src.indexOf('function postMultipart'), src.indexOf('probeDurationSeconds'));
    expect(hotPath).not.toMatch(/\bfetch\(/);
  });
});
