import { checkHealth } from '../services/health.service';

jest.mock('../db/db', () => ({ query: jest.fn() }));
import { query } from '../db/db';

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  accessSync: jest.fn(),
}));
import * as fs from 'fs';

jest.mock('../services/whisper-local.service', () => ({
  isLocalWhisperAvailable: jest.fn(),
  isTranscribeServiceAvailable: jest.fn(),
}));
import { isLocalWhisperAvailable, isTranscribeServiceAvailable } from '../services/whisper-local.service';

describe('checkHealth', () => {
  beforeEach(() => {
    // resetAllMocks (а не clearAllMocks) — иначе throw-реализация fs.accessSync
    // из теста про vault переживает jest.clearAllMocks() и утекает в следующие тесты.
    jest.resetAllMocks();
    // Дефолт для тестов, которым безразличен статус whisper и vault.
    (isLocalWhisperAvailable as jest.Mock).mockReturnValue(false);
    (isTranscribeServiceAvailable as jest.Mock).mockResolvedValue(false);
  });

  test('живая база и доступный vault → status ok', async () => {
    (query as jest.Mock).mockResolvedValue({ rows: [{ ok: 1 }] });
    const r = await checkHealth();
    const db = r.checks.find((c) => c.name === 'postgres');
    expect(db?.ok).toBe(true);
    expect(['ok', 'degraded']).toContain(r.status);
  });

  test('мёртвая база → status down, а не ok', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    (query as jest.Mock).mockRejectedValue(new Error('connection refused'));
    const r = await checkHealth();
    expect(r.status).toBe('down');
    const db = r.checks.find((c) => c.name === 'postgres');
    expect(db?.ok).toBe(false);
    errSpy.mockRestore();
  });

  test('отчёт содержит проверки по всем зависимостям', async () => {
    (query as jest.Mock).mockResolvedValue({ rows: [{ ok: 1 }] });
    const names = (await checkHealth()).checks.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['postgres', 'vault', 'whisper', 'llm']));
  });

  test('мёртвая база → detail не содержит текст исходной ошибки драйвера', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    (query as jest.Mock).mockRejectedValue(
      new Error('password authentication failed for user "kanban_admin" at host 10.0.0.5:5432')
    );
    const r = await checkHealth();
    const db = r.checks.find((c) => c.name === 'postgres');
    expect(db?.ok).toBe(false);
    expect(db?.detail).not.toContain('kanban_admin');
    expect(db?.detail).not.toContain('10.0.0.5');
    expect(db?.detail).not.toMatch(/password authentication failed/);
    // подробность не теряется — она уходит в серверный лог
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  test('vault недоступен → detail не содержит путь на диске', async () => {
    (query as jest.Mock).mockResolvedValue({ rows: [{ ok: 1 }] });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    (fs.accessSync as jest.Mock).mockImplementation(() => {
      throw new Error("EACCES: permission denied, access '/var/www/kanban-app/vault'");
    });
    const r = await checkHealth();
    const vault = r.checks.find((c) => c.name === 'vault');
    expect(vault?.ok).toBe(false);
    expect(vault?.detail).not.toMatch(/\/var\/www|\/root|EACCES/);
    errSpy.mockRestore();
  });

  test('микросервис транскрипции жив, локальный бинарь недоступен → whisper ok', async () => {
    (query as jest.Mock).mockResolvedValue({ rows: [{ ok: 1 }] });
    (isLocalWhisperAvailable as jest.Mock).mockReturnValue(false);
    (isTranscribeServiceAvailable as jest.Mock).mockResolvedValue(true);
    const r = await checkHealth();
    const whisper = r.checks.find((c) => c.name === 'whisper');
    expect(whisper?.ok).toBe(true);
  });

  test('оба бэкенда расшифровки недоступны → whisper not ok', async () => {
    (query as jest.Mock).mockResolvedValue({ rows: [{ ok: 1 }] });
    (isLocalWhisperAvailable as jest.Mock).mockReturnValue(false);
    (isTranscribeServiceAvailable as jest.Mock).mockResolvedValue(false);
    const r = await checkHealth();
    const whisper = r.checks.find((c) => c.name === 'whisper');
    expect(whisper?.ok).toBe(false);
  });
});

/**
 * 152-ФЗ: /health отражает состояние флага TRANSCRIPTION_ALLOW_CLOUD_FALLBACK.
 * Эндпоинт не требует авторизации, поэтому в detail — только факт «разрешён/запрещён»,
 * без путей, адресов и ключей. Модуль config кэширует значение при импорте, поэтому
 * каждый тест сбрасывает реестр модулей и переимпортирует health.service заново.
 */
describe('checkHealth: политика облачного фолбэка расшифровки (152-ФЗ)', () => {
  const ORIGINAL = process.env['TRANSCRIPTION_ALLOW_CLOUD_FALLBACK'];

  function setupMocks(): void {
    const db = require('../db/db');
    (db.query as jest.Mock).mockResolvedValue({ rows: [{ ok: 1 }] });
    const fsMock = require('fs');
    (fsMock.accessSync as jest.Mock).mockImplementation(() => {});
    const whisper = require('../services/whisper-local.service');
    (whisper.isLocalWhisperAvailable as jest.Mock).mockReturnValue(true);
    (whisper.isTranscribeServiceAvailable as jest.Mock).mockResolvedValue(true);
  }

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env['TRANSCRIPTION_ALLOW_CLOUD_FALLBACK'];
    else process.env['TRANSCRIPTION_ALLOW_CLOUD_FALLBACK'] = ORIGINAL;
  });

  test('флаг не задан → /health показывает облачный фолбэк разрешённым', async () => {
    jest.resetModules();
    delete process.env['TRANSCRIPTION_ALLOW_CLOUD_FALLBACK'];
    setupMocks();
    const { checkHealth: freshCheckHealth } = require('../services/health.service');
    const r = await freshCheckHealth();
    const c = r.checks.find((x: { name: string }) => x.name === 'transcription-policy');
    expect(c?.ok).toBe(true);
    expect(c?.detail).toMatch(/разрешён/);
    // Ветка "разрешено" — не только запрещающая — не должна раскрывать пути/адреса/ключи.
    expect(c?.detail).not.toMatch(/\/|https?:|sk-|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
  });

  test('TRANSCRIPTION_ALLOW_CLOUD_FALLBACK=false → /health показывает облачный фолбэк запрещённым', async () => {
    jest.resetModules();
    process.env['TRANSCRIPTION_ALLOW_CLOUD_FALLBACK'] = 'false';
    setupMocks();
    const { checkHealth: freshCheckHealth } = require('../services/health.service');
    const r = await freshCheckHealth();
    const c = r.checks.find((x: { name: string }) => x.name === 'transcription-policy');
    expect(c?.ok).toBe(true);
    expect(c?.detail).toMatch(/запрещён/);
  });

  test('detail не содержит путей, адресов или ключей (обе ветки флага)', async () => {
    for (const value of ['false', undefined] as const) {
      jest.resetModules();
      if (value === undefined) delete process.env['TRANSCRIPTION_ALLOW_CLOUD_FALLBACK'];
      else process.env['TRANSCRIPTION_ALLOW_CLOUD_FALLBACK'] = value;
      setupMocks();
      const { checkHealth: freshCheckHealth } = require('../services/health.service');
      const r = await freshCheckHealth();
      const c = r.checks.find((x: { name: string }) => x.name === 'transcription-policy');
      expect(c?.detail).not.toMatch(/\/|https?:|sk-|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
    }
  });
});

/**
 * Задача 5: провайдер LLM переключается переменной OPENAI_BASE_URL. /health не защищён
 * авторизацией — detail проверки "llm" должен содержать только короткую метку
 * провайдера, а не URL/хост/ключ (иначе анонимный запрос к /health раскрывает
 * внутреннюю топологию).
 */
describe('checkHealth: метка провайдера LLM в detail (без раскрытия хоста/ключа)', () => {
  const ORIGINAL_KEY = process.env['OPENAI_API_KEY'];
  const ORIGINAL_URL = process.env['OPENAI_BASE_URL'];

  function setupMocks(): void {
    const db = require('../db/db');
    (db.query as jest.Mock).mockResolvedValue({ rows: [{ ok: 1 }] });
    const fsMock = require('fs');
    (fsMock.accessSync as jest.Mock).mockImplementation(() => {});
    const whisper = require('../services/whisper-local.service');
    (whisper.isLocalWhisperAvailable as jest.Mock).mockReturnValue(true);
    (whisper.isTranscribeServiceAvailable as jest.Mock).mockResolvedValue(true);
  }

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env['OPENAI_API_KEY']; else process.env['OPENAI_API_KEY'] = ORIGINAL_KEY;
    if (ORIGINAL_URL === undefined) delete process.env['OPENAI_BASE_URL']; else process.env['OPENAI_BASE_URL'] = ORIGINAL_URL;
  });

  test('провайдер сменён на Яндекс через OPENAI_BASE_URL → detail показывает метку "yandex", а не URL', async () => {
    jest.resetModules();
    process.env['OPENAI_API_KEY'] = 'sk-secret-test-key-123';
    process.env['OPENAI_BASE_URL'] = 'https://llm.api.cloud.yandex.net/v1';
    setupMocks();
    const { checkHealth: freshCheckHealth } = require('../services/health.service');
    const r = await freshCheckHealth();
    const c = r.checks.find((x: { name: string }) => x.name === 'llm');
    expect(c?.ok).toBe(true);
    expect(c?.detail).toContain('yandex');
    // Ни полного URL, ни голого хоста, ни ключа быть не должно — только короткая метка.
    expect(c?.detail).not.toMatch(/https?:\/\/|llm\.api\.cloud\.yandex\.net|sk-secret-test-key-123/);
  });

  // Провайдер поднят на IP (самосев модели "для локализации данных в РФ") — старая
  // реализация llmProviderName() брала "второй с конца" сегмент домена и отдавала
  // один октет IP ("1" из 192.168.1.5). Незащищённый /health не должен светить даже
  // обрывком внутреннего адреса.
  test('провайдер на IP-хосте → detail показывает нейтральную метку, а не обрывок адреса', async () => {
    jest.resetModules();
    process.env['OPENAI_API_KEY'] = 'sk-secret-test-key-123';
    process.env['OPENAI_BASE_URL'] = 'http://192.168.1.5:8080/v1';
    setupMocks();
    const { checkHealth: freshCheckHealth } = require('../services/health.service');
    const r = await freshCheckHealth();
    const c = r.checks.find((x: { name: string }) => x.name === 'llm');
    expect(c?.ok).toBe(true);
    expect(c?.detail).toBe('провайдер: custom');
    expect(c?.detail).not.toMatch(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|sk-secret-test-key-123/);
  });
});
