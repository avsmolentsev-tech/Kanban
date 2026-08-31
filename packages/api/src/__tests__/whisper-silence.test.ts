import * as http from 'http';
import type { AddressInfo } from 'net';
import { EventEmitter } from 'events';
import { buildSilenceFilter } from '../services/whisper-local.service';

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
  beforeEach(() => {
    jest.resetModules();
    process.env['TRANSCRIBE_SERVICE_URL'] = 'http://127.0.0.1:1'; // заведомо недоступен
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

  beforeAll((done) => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
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
    process.env['TRANSCRIBE_SERVICE_URL'] = `http://127.0.0.1:${port}`;
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
});
