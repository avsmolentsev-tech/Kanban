import * as http from 'http';
import type { AddressInfo } from 'net';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import { buildSilenceFilter, formatSegmentFailure } from '../services/whisper-local.service';

// `require`, а не `import * as` — у TS-компиляции неймспейс-импорта built-in
// модуля свойства выходят non-configurable, и jest.spyOn падает с
// "Cannot redefine property: spawn". Через require свойства модуля обычные.
const child_process = require('child_process');

describe('обрезка тишины перед whisper', () => {
  test('фильтр вырезает тишину с обоих концов и длинные паузы внутри', () => {
    const f = buildSilenceFilter();
    expect(f).toContain('silenceremove');
    expect(f).toContain('start_periods=1');
    expect(f).toContain('stop_periods=-1');
    expect(f).toMatch(/-40dB|-45dB|-50dB/);
  });

  test('фильтр не схлопывает короткие естественные паузы', () => {
    const f = buildSilenceFilter();
    const dur = f.match(/stop_duration=([\d.]+)/);
    expect(dur).not.toBeNull();
    expect(parseFloat(dur![1])).toBeGreaterThanOrEqual(1);
  });
});

/**
 * На проде расшифровка почти всегда идёт через микросервис faster-whisper
 * (transcribeViaService), а не через фолбэк whisper.cpp — контейнер жив,
 * TRANSCRIBE_SERVICE_URL не переопределён. Фильтр тишины, подключённый только
 * в фолбэке, на проде не делает ничего: этот путь и есть основной.
 */
describe('обрезка тишины на пути через faster-whisper микросервис', () => {
  const originalUrl = process.env['TRANSCRIBE_SERVICE_URL'];

  beforeEach(() => {
    jest.resetModules();
    process.env['TRANSCRIBE_SERVICE_URL'] = 'http://127.0.0.1:1'; // заведомо недоступен
  });

  // Под --runInBand все тестовые файлы делят один process.env — не восстановить
  // значение здесь означало бы, что следующий тестовый файл, полагающийся на
  // дефолтный TRANSCRIBE_SERVICE_URL, начинает падать в зависимости от порядка запуска.
  afterEach(() => {
    if (originalUrl === undefined) delete process.env['TRANSCRIBE_SERVICE_URL'];
    else process.env['TRANSCRIBE_SERVICE_URL'] = originalUrl;
  });

  test('перед отправкой в сервис файл прогоняется через ffmpeg с buildSilenceFilter() в аргументах', async () => {
    const spy = jest.spyOn(child_process, 'spawn');
    const { transcribeViaService, buildSilenceFilter: filterFn } = require('../services/whisper-local.service');

    // Дальше запрос к сервису неизбежно упадёт (адрес заведомо недоступен) —
    // нас интересует только сам факт и аргументы прохода ffmpeg до этого шага.
    await transcribeViaService(Buffer.alloc(64, 1), 'meeting.mp3').catch(() => {});

    const ffmpegCall = spy.mock.calls.find(([cmd]) => cmd === 'ffmpeg');
    expect(ffmpegCall).toBeTruthy();
    const args = ffmpegCall![1] as string[];
    expect(args).toContain('-af');
    expect(args).toContain(filterFn());

    spy.mockRestore();
  });
});

describe('отказоустойчивость обрезки тишины', () => {
  let server: http.Server;
  let port: number;
  let received: { body: Buffer } | null = null;
  const originalUrl = process.env['TRANSCRIBE_SERVICE_URL'];

  beforeAll((done) => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        received = { body: Buffer.concat(chunks) };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ text: 'расшифровано на исходном аудио' }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port;
      done();
    });
  });

  afterAll((done) => { server.close(() => done()); });

  beforeEach(() => {
    jest.resetModules();
    received = null;
    process.env['TRANSCRIBE_SERVICE_URL'] = `http://127.0.0.1:${port}`;
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env['TRANSCRIBE_SERVICE_URL'];
    else process.env['TRANSCRIBE_SERVICE_URL'] = originalUrl;
  });

  test('сбой ffmpeg на обрезке тишины не роняет расшифровку — идёт исходное аудио', async () => {
    // Симулируем реальный сбой прохода ffmpeg независимо от того, установлен
    // ли ffmpeg в окружении, где гоняется тест: только вызов с фильтром тишины
    // проваливается, остальные (ffprobe и т.д.) идут по-настоящему.
    const realSpawn = child_process.spawn;
    const spy = jest.spyOn(child_process, 'spawn').mockImplementation((cmd: any, args: any, opts: any) => {
      if (cmd === 'ffmpeg' && Array.isArray(args) && args.includes('-af') &&
        args.some((a: unknown) => typeof a === 'string' && a.includes('silenceremove'))) {
        const fake = new EventEmitter() as any;
        fake.stdout = new EventEmitter();
        fake.stderr = new EventEmitter();
        fake.kill = () => {};
        process.nextTick(() => fake.emit('error', new Error('ffmpeg упал специально для теста')));
        return fake;
      }
      return realSpawn(cmd, args, opts);
    });

    const { transcribeViaService } = require('../services/whisper-local.service');
    const text = await transcribeViaService(Buffer.alloc(64, 2), 'meeting.mp3');

    expect(text).toBe('расшифровано на исходном аудио');

    spy.mockRestore();
  });

  test('успешная обрезка добавляет .mp3 даже файлу без расширения вообще', async () => {
    // Симулируем УСПЕШНУЮ обрезку: пишем dummy-файл туда, куда указывает выходной
    // путь ffmpeg (последний позиционный аргумент перед '-y'), и завершаемся кодом 0.
    const realSpawn = child_process.spawn;
    const spy = jest.spyOn(child_process, 'spawn').mockImplementation((cmd: any, args: any, opts: any) => {
      if (cmd === 'ffmpeg' && Array.isArray(args) && args.includes('-af') &&
        args.some((a: unknown) => typeof a === 'string' && a.includes('silenceremove'))) {
        const outPath = args[args.indexOf('-y') - 1];
        fs.writeFileSync(outPath, Buffer.alloc(16, 9));
        const fake = new EventEmitter() as any;
        fake.stdout = new EventEmitter();
        fake.stderr = new EventEmitter();
        fake.kill = () => {};
        process.nextTick(() => fake.emit('close', 0));
        return fake;
      }
      return realSpawn(cmd, args, opts);
    });

    const { transcribeViaService } = require('../services/whisper-local.service');
    // "recording" без единой точки — .replace(/\.[^.]+$/, ...) на таком имени
    // ничего не меняет, .mp3 нужно ДОБАВИТЬ, а не только заменить расширение.
    await transcribeViaService(Buffer.alloc(64, 5), 'recording');

    expect(received).not.toBeNull();
    expect(received!.body.toString('utf-8')).toContain('filename="recording.mp3"');

    spy.mockRestore();
  });
});

/**
 * Регресс: подпись пропавшего сегмента раньше считала минуты как
 * `индекс × CHUNK_SECONDS`, что было честно, пока сегментирование шло по
 * исходному аудио. После обрезки тишины (silenceremove схлопывает все паузы
 * длиннее 1.5с, не только по краям) минута по номеру сегмента больше не
 * совпадает с минутой в исходной записи — подпись должна называть номер
 * фрагмента, а не врущее время.
 */
describe('подпись пропавшего сегмента честна после обрезки тишины', () => {
  test('называет номер фрагмента, а не минуты записи', () => {
    expect(formatSegmentFailure(0, 7)).toBe('[фрагмент 1 из 7 не распознан]');
    expect(formatSegmentFailure(2, 7)).toBe('[фрагмент 3 из 7 не распознан]');
    expect(formatSegmentFailure(6, 7)).toBe('[фрагмент 7 из 7 не распознан]');
  });

  test('в подписи нет упоминания минут — время после обрезки тишины нелинейно исходному', () => {
    const label = formatSegmentFailure(3, 10);
    expect(label).not.toMatch(/мин/);
  });

  test('ветка провала сегмента использует formatSegmentFailure, а не старую формулу по минутам', () => {
    const src = fs.readFileSync(require.resolve('../services/whisper-local.service.ts'), 'utf-8');
    expect(src).toMatch(/parts\[i\] = formatSegmentFailure\(i, segmentPaths\.length\)/);
    // старая формула минут по номеру сегмента (index * CHUNK_SECONDS / 60) ушла целиком
    expect(src).not.toMatch(/i \* CHUNK_SECONDS/);
  });
});
