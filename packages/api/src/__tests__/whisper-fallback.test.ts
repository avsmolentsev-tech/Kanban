/**
 * Запасной путь (whisper.cpp) включается, когда микросервис faster-whisper лежит.
 * 10–13 августа он проработал четыре дня незамеченным и съел половину
 * полуторачасовой записи: не было ни флага против петель, ни чистки результата,
 * ни единого сигнала о том, что качество упало. Здесь это зафиксировано.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = fs.readFileSync(path.join(__dirname, '..', 'services', 'whisper-local.service.ts'), 'utf-8');

/** Тело transcribeLocal — от объявления до конца файла. */
const fallback = SRC.slice(SRC.indexOf('export async function transcribeLocal'));

describe('защита запасного пути', () => {
  test('whisper.cpp вызывается с -mc 0 — контекст между окнами не переносится', () => {
    const call = SRC.slice(SRC.indexOf('runCommand(WHISPER_CLI'), SRC.indexOf("runCommand(WHISPER_CLI") + 800);
    expect(call).toMatch(/'-mc',\s*'0'/);
  });

  test('язык и текстовый вывод не потеряны', () => {
    const call = SRC.slice(SRC.indexOf('runCommand(WHISPER_CLI'), SRC.indexOf("runCommand(WHISPER_CLI") + 800);
    expect(call).toContain("'-otxt'");
    expect(call).toMatch(/'-l',\s*'ru'/);
  });

  test('результат прогоняется через чистку от галлюцинаций', () => {
    expect(fallback).toMatch(/sanitizeTranscript\(raw\)/);
    expect(fallback).toMatch(/cleaned\.text/);
  });

  test('плотность речи проверяется и уходит в предупреждение', () => {
    expect(fallback).toMatch(/transcriptQuality\(/);
    expect(fallback).toMatch(/quality\.suspicious/);
  });

  test('о переходе на слабую модель сообщают, а не молчат', () => {
    expect(fallback).toMatch(/notifyDegraded\(/);
    // и когда сервис недоступен, и когда он ответил ошибкой
    const calls = fallback.match(/notifyDegraded\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  test('уведомление не спамит: не чаще раза в час', () => {
    expect(SRC).toMatch(/lastDegradedNotice/);
    expect(SRC).toMatch(/HOUR = 3600_000/);
  });

  test('в usage_logs фолбэк по-прежнему пишется как whisper-local', () => {
    // по этой метке мы и опознали аварию 13 августа — её нельзя терять
    expect(fallback).toContain("'whisper-local'");
  });
});

describe('обходной путь для больших файлов', () => {
  const TG = fs.readFileSync(path.join(__dirname, '..', 'services', 'telegram.service.ts'), 'utf-8');

  test('/transcribe <ссылка> дожидается расшифровки, а не роняет Promise', () => {
    expect(TG).toMatch(/transcript = await transcribeLocal\(buffer, 'download\.mp3'\)/);
    expect(TG).not.toMatch(/transcript = transcribeLocal\(/);
  });

  test('сообщение про лимит объясняет оба обхода', () => {
    const msgs = TG.match(/Telegram не отдаёт ботам файлы тяжелее 20 МБ/g) ?? [];
    expect(msgs.length).toBe(3); // документ, аудио, видео
    expect(TG).toContain('/transcribe <ссылка>');
    expect(TG).toContain('clarity-space.ru');
  });
});
