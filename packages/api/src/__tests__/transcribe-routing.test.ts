/**
 * Веб-загрузка встречи должна расшифровывать локально и бесплатно.
 * Раньше первым шёл платный OpenAI whisper-1 (если был ключ и файл ≤ 24 МБ),
 * а локальный бесплатный бэкенд стоял лишь фолбэком — запись молча уезжала
 * в облако, хотя рядом работал микросервис faster-whisper.
 *
 * Проверяем контракт по исходнику: порядок ветвления в processAudioInBackground.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'routes', 'meetings.ts'),
  'utf-8',
);

/** Тело processAudioInBackground до шага сохранения. */
const body = SRC.slice(
  SRC.indexOf('async function processAudioInBackground'),
  SRC.indexOf('// Step 3'),
);

describe('приоритет бэкендов при веб-загрузке', () => {
  test('локальная расшифровка проверяется раньше платного облака', () => {
    const localAt = body.indexOf('await transcribeLocal(');
    const openAiAt = body.indexOf('whisper-1');
    expect(localAt).toBeGreaterThan(-1);
    expect(openAiAt).toBeGreaterThan(-1);
    // ветка локального вызова стоит раньше, чем реальный вызов облака
    expect(body.indexOf('if (localReady)')).toBeLessThan(body.indexOf('} else if (canUseOpenAI)'));
  });

  test('готовность локального бэкенда учитывает и микросервис, и whisper.cpp', () => {
    expect(body).toMatch(/const localReady = \(await isTranscribeServiceAvailable\(\)\) \|\| isLocalWhisperAvailable\(\)/);
  });

  test('облако вызывается только после провала локального', () => {
    const localBlock = body.slice(body.indexOf('if (localReady)'), body.indexOf('} else if (canUseOpenAI)'));
    // внутри локальной ветки облако появляется исключительно в catch
    const catchAt = localBlock.indexOf('} catch (err) {');
    const fallbackAt = localBlock.indexOf('viaOpenAI()');
    expect(catchAt).toBeGreaterThan(-1);
    expect(fallbackAt).toBeGreaterThan(catchAt);
  });

  test('без локального бэкенда уход в облако логируется как исключение', () => {
    expect(body).toMatch(/no local backend available, using paid OpenAI/);
  });

  test('лимит 24 МБ остаётся только для облачной ветки, локальную не ограничивает', () => {
    expect(body).toMatch(/const canUseOpenAI = canOpenAI && finalMb <= OPENAI_LIMIT_MB/);
    const localBlock = body.slice(body.indexOf('if (localReady)'), body.indexOf('} else if (canUseOpenAI)'));
    expect(localBlock).not.toMatch(/OPENAI_LIMIT_MB/);
  });

  test('имя временного файла для облака по-прежнему обеззараживается', () => {
    expect(body).toMatch(/path\.extname\(safeTmpName\(audioName\)\)/);
  });
});
