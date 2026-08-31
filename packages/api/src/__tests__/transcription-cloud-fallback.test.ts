/**
 * 152-ФЗ: сырая запись голоса — самые чувствительные персданные, а фолбэк
 * расшифровки на OpenAI whisper-1 — трансграничная передача в США. Флаг
 * TRANSCRIPTION_ALLOW_CLOUD_FALLBACK разрешает/запрещает этот фолбэк.
 * Переменная не задана → поведение прода не меняется (фолбэк разрешён).
 */
import * as fs from 'fs';
import * as path from 'path';
import { assertCloudFallbackAllowed } from '../services/transcription-policy';

describe('config.transcriptionAllowCloudFallback: обе ветки флага', () => {
  const ORIGINAL = process.env['TRANSCRIPTION_ALLOW_CLOUD_FALLBACK'];
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    if (ORIGINAL === undefined) delete process.env['TRANSCRIPTION_ALLOW_CLOUD_FALLBACK'];
    else process.env['TRANSCRIPTION_ALLOW_CLOUD_FALLBACK'] = ORIGINAL;
  });

  test('переменная не задана → фолбэк разрешён (поведение прода не меняется)', () => {
    delete process.env['TRANSCRIPTION_ALLOW_CLOUD_FALLBACK'];
    const { config } = require('../config');
    expect(config.transcriptionAllowCloudFallback).toBe(true);
  });

  test('TRANSCRIPTION_ALLOW_CLOUD_FALLBACK=false → фолбэк запрещён', () => {
    process.env['TRANSCRIPTION_ALLOW_CLOUD_FALLBACK'] = 'false';
    const { config } = require('../config');
    expect(config.transcriptionAllowCloudFallback).toBe(false);
  });

  /**
   * Раньше (`!== 'false'`) любое другое запрещающее значение — '0', 'no', 'off',
   * другой регистр, случайные пробелы — тихо давало `true` (фолбэк разрешён).
   * Оператор, выставивший `=0` или `=OFF` для комплаенса, получал ПРОТИВОПОЛОЖНОЕ
   * тому, что настраивал, и ничего об этом не узнавал. Таблица покрывает ровно тот
   * набор значений, ради которого была правка на явный список в config/index.ts —
   * без неё будущее упрощение обратно на `!== 'false'` осталось бы зелёным.
   */
  describe.each([
    ['false', false], ['FALSE', false], ['0', false], ['no', false], ['off', false], [' Off ', false],
    [undefined, true], ['', true], ['true', true], ['yes', true], ['maybe', true],
  ])('TRANSCRIPTION_ALLOW_CLOUD_FALLBACK=%p', (value, expected) => {
    test(`→ transcriptionAllowCloudFallback === ${expected}`, () => {
      jest.resetModules();
      if (value === undefined) delete process.env['TRANSCRIPTION_ALLOW_CLOUD_FALLBACK'];
      else process.env['TRANSCRIPTION_ALLOW_CLOUD_FALLBACK'] = value;
      const { config } = require('../config');
      expect(config.transcriptionAllowCloudFallback).toBe(expected);
    });
  });
});

/**
 * Поведенческая проверка самого узкого места: раньше здесь стоял только тест по
 * тексту исходника (совпадение порядка подстрок), который прошёл бы, даже если
 * бы guard физически не мог остановить выполнение (например, был бы веткой без
 * throw). `assertCloudFallbackAllowed` — реальная функция, вызываемая на обеих
 * точках processAudioInBackground перед `viaOpenAI()`; здесь она вызывается
 * напрямую и проверяется её фактическое поведение — бросает ли она исключение.
 */
describe('assertCloudFallbackAllowed: реальное поведение guard-функции', () => {
  test('cloudFallbackAllowed=false → бросает исключение (провал локального бэкенда)', () => {
    expect(() => assertCloudFallbackAllowed(false, 'local-failed')).toThrow(
      /облачный фолбэк отключён политикой обработки персональных данных \(152-ФЗ\)/
    );
  });

  test('cloudFallbackAllowed=false → бросает исключение (локального бэкенда нет вовсе)', () => {
    expect(() => assertCloudFallbackAllowed(false, 'no-local-backend')).toThrow(
      /облачный фолбэк отключён политикой обработки персональных данных \(152-ФЗ\)/
    );
  });

  test('cloudFallbackAllowed=true → ничего не бросает, выполнение может продолжиться до viaOpenAI()', () => {
    expect(() => assertCloudFallbackAllowed(true, 'local-failed')).not.toThrow();
    expect(() => assertCloudFallbackAllowed(true, 'no-local-backend')).not.toThrow();
  });
});

describe('meetings.ts: обе точки фолбэка реально вызывают guard перед viaOpenAI()', () => {
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'meetings.ts'), 'utf-8');
  const body = SRC.slice(
    SRC.indexOf('async function processAudioInBackground'),
    SRC.indexOf('// Step 3'),
  );

  test('политика читается из config.transcriptionAllowCloudFallback', () => {
    expect(body).toMatch(/const cloudFallbackAllowed = config\.transcriptionAllowCloudFallback/);
  });

  test('после провала локального бэкенда guard вызывается раньше viaOpenAI()', () => {
    const catchBlock = body.slice(body.indexOf('} catch (err) {'), body.indexOf('} else if (canUseOpenAI && cloudFallbackAllowed)'));
    const guardAt = catchBlock.indexOf("assertCloudFallbackAllowed(cloudFallbackAllowed, 'Локальная расшифровка не удалась')");
    const callAt = catchBlock.indexOf('viaOpenAI()');
    expect(guardAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(guardAt);
  });

  test('при отсутствии локального бэкенда guard вызывается в ветке без cloudFallbackAllowed', () => {
    expect(body).toMatch(/else if \(canUseOpenAI && !cloudFallbackAllowed\) \{\s*assertCloudFallbackAllowed\(cloudFallbackAllowed, 'Локальный бэкенд расшифровки недоступен'\);/);
  });
});

describe('whisper-queue.ts: transcribeWithOpenAI реально блокируется флагом (поведенческий тест)', () => {
  const ORIGINAL = process.env['TRANSCRIPTION_ALLOW_CLOUD_FALLBACK'];

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env['TRANSCRIPTION_ALLOW_CLOUD_FALLBACK'];
    else process.env['TRANSCRIPTION_ALLOW_CLOUD_FALLBACK'] = ORIGINAL;
  });

  /**
   * Единственный путь этого файла, который можно проверить БЕЗ мока сети: при
   * запрете флагом функция обязана бросить исключение раньше создания клиента
   * OpenAI и раньше сетевого запроса — то есть без всякого мока `openai` пакета.
   * Если бы guard был случайно убран или закомментирован, этот тест поймал бы
   * реальный сетевой вызов (или как минимум попытку создать клиент без ключа)
   * вместо ожидаемого исключения.
   */
  test('TRANSCRIPTION_ALLOW_CLOUD_FALLBACK=false → transcribeWithOpenAI бросает исключение до сетевого вызова', async () => {
    jest.resetModules();
    process.env['TRANSCRIPTION_ALLOW_CLOUD_FALLBACK'] = 'false';
    const { transcribeWithOpenAI } = require('../services/whisper-queue');
    await expect(transcribeWithOpenAI(Buffer.from('x'), 'a.mp3')).rejects.toThrow(
      /облачный фолбэк отключён политикой обработки персональных данных \(152-ФЗ\)/
    );
  });
});

describe('parsers/audio.parser.ts: parseAudio реально блокируется флагом (поведенческий тест)', () => {
  const ORIGINAL = process.env['TRANSCRIPTION_ALLOW_CLOUD_FALLBACK'];

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env['TRANSCRIPTION_ALLOW_CLOUD_FALLBACK'];
    else process.env['TRANSCRIPTION_ALLOW_CLOUD_FALLBACK'] = ORIGINAL;
  });

  test('TRANSCRIPTION_ALLOW_CLOUD_FALLBACK=false → /v1/ingest аудио бросает исключение до сетевого вызова', async () => {
    jest.resetModules();
    process.env['TRANSCRIPTION_ALLOW_CLOUD_FALLBACK'] = 'false';
    const { parseAudio } = require('../parsers/audio.parser');
    await expect(parseAudio(Buffer.from('x'), 'mp3')).rejects.toThrow(
      /облачный фолбэк отключён политикой обработки персональных данных \(152-ФЗ\)/
    );
  });
});

describe('assertCloudFallbackAllowed: единый chokepoint для всех путей, отправляющих аудио в OpenAI', () => {
  /**
   * 152-ФЗ: раньше только веб-загрузка встречи (routes/meetings.ts) проверяла флаг —
   * services/whisper-queue.ts (очередь Telegram, включая прямой путь для pro_max),
   * parsers/audio.parser.ts (/v1/ingest) и команда /transcribe в telegram.service.ts
   * звали OpenAI мимо проверки. Источниковый тест здесь — не потому что поведение
   * непроверяемо (assertCloudFallbackAllowed уже проверена выше напрямую), а потому
   * что сами вызывающие функции делают реальный сетевой запрос к OpenAI и не мокаются
   * в проекте без большого объёма инфраструктуры — тот же принцип, что уже принят
   * (whisper-fallback.test.ts, transcribe-routing.test.ts).
   */
  test('whisper-queue.ts: transcribeWithOpenAI зовёт guard раньше самого запроса к OpenAI', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'whisper-queue.ts'), 'utf-8');
    const fn = src.slice(src.indexOf('export async function transcribeWithOpenAI'));
    const guardAt = fn.indexOf('assertCloudFallbackAllowed(');
    const callAt = fn.indexOf('audio.transcriptions.create(');
    expect(guardAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(guardAt);
  });

  test('audio.parser.ts: parseAudio зовёт guard раньше самого запроса к OpenAI', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'parsers', 'audio.parser.ts'), 'utf-8');
    const guardAt = src.indexOf('assertCloudFallbackAllowed(');
    const callAt = src.indexOf('audio.transcriptions.create(');
    expect(guardAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(guardAt);
  });

  test('telegram.service.ts: команда /transcribe зовёт guard раньше самого запроса к OpenAI', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'telegram.service.ts'), 'utf-8');
    const cmd = src.slice(src.indexOf("this.bot.command('transcribe'"), src.indexOf("this.bot.command('habits'"));
    const guardAt = cmd.indexOf('assertCloudFallbackAllowed(');
    const callAt = cmd.indexOf('audio.transcriptions.create(');
    expect(guardAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(guardAt);
  });
});
