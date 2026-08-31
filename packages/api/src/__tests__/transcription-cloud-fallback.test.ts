/**
 * 152-ФЗ: сырая запись голоса — самые чувствительные персданные, а фолбэк
 * расшифровки на OpenAI whisper-1 — трансграничная передача в США. Флаг
 * TRANSCRIPTION_ALLOW_CLOUD_FALLBACK разрешает/запрещает этот фолбэк.
 * Переменная не задана → поведение прода не меняется (фолбэк разрешён).
 */
import * as fs from 'fs';
import * as path from 'path';
import { assertCloudFallbackAllowed } from '../routes/meetings';

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
    const guardAt = catchBlock.indexOf("assertCloudFallbackAllowed(cloudFallbackAllowed, 'local-failed')");
    const callAt = catchBlock.indexOf('viaOpenAI()');
    expect(guardAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(guardAt);
  });

  test('при отсутствии локального бэкенда guard вызывается в ветке без cloudFallbackAllowed', () => {
    expect(body).toMatch(/else if \(canUseOpenAI && !cloudFallbackAllowed\) \{\s*assertCloudFallbackAllowed\(cloudFallbackAllowed, 'no-local-backend'\);/);
  });
});
