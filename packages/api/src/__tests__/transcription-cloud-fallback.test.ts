/**
 * 152-ФЗ: сырая запись голоса — самые чувствительные персданные, а фолбэк
 * расшифровки на OpenAI whisper-1 — трансграничная передача в США. Флаг
 * TRANSCRIPTION_ALLOW_CLOUD_FALLBACK разрешает/запрещает этот фолбэк.
 * Переменная не задана → поведение прода не меняется (фолбэк разрешён).
 */
import * as fs from 'fs';
import * as path from 'path';

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

describe('meetings.ts: облачный фолбэк расшифровки подчиняется флагу', () => {
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'meetings.ts'), 'utf-8');
  const body = SRC.slice(
    SRC.indexOf('async function processAudioInBackground'),
    SRC.indexOf('// Step 3'),
  );

  test('политика читается из config.transcriptionAllowCloudFallback', () => {
    expect(body).toMatch(/const cloudFallbackAllowed = config\.transcriptionAllowCloudFallback/);
  });

  test('после провала локального бэкенда viaOpenAI() вызывается только если фолбэк разрешён политикой', () => {
    const catchBlock = body.slice(body.indexOf('} catch (err) {'), body.indexOf('} else if (canUseOpenAI && cloudFallbackAllowed)'));
    const guardAt = catchBlock.indexOf('if (!cloudFallbackAllowed)');
    const callAt = catchBlock.indexOf('viaOpenAI()');
    expect(guardAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(guardAt);
  });

  test('при отсутствии локального бэкенда viaOpenAI() тоже вызывается только с разрешённым флагом', () => {
    expect(body).toMatch(/else if \(canUseOpenAI && cloudFallbackAllowed\)/);
  });

  test('выключенный флаг даёт честную русскую ошибку вместо тихой отправки в облако', () => {
    const messages = body.match(/облачный фолбэк отключён политикой обработки персональных данных \(152-ФЗ\)/g) ?? [];
    // Оба пути ветвления (провал локального бэкенда и его полное отсутствие) должны
    // предупреждать честно — а не молча уходить в viaOpenAI() или ронять неясную ошибку.
    expect(messages.length).toBe(2);
  });
});
