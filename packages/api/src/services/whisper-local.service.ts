import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { sanitizeTranscript, transcriptQuality } from './transcript-sanitize';

const WHISPER_CLI ='/opt/whisper.cpp/build/bin/whisper-cli';
const WHISPER_MODEL = '/opt/whisper.cpp/models/ggml-small.bin';

/** Check if local whisper.cpp is available */
export function isLocalWhisperAvailable(): boolean {
  return fs.existsSync(WHISPER_CLI) && fs.existsSync(WHISPER_MODEL);
}

/**
 * Обеззараживает имя загруженного файла перед подстановкой в путь.
 *
 * `req.file.originalname` приходит от клиента как есть, multer его не трогает.
 * `path.join('/tmp', 'whisper-1-' + '../../../etc/cron.d/x')` схлопывается
 * в `/etc/cron.d/x`: первый `..` съедается литеральным сегментом `whisper-1-..`,
 * остальные выводят за пределы /tmp — и буфер пишется (а потом удаляется)
 * по произвольному пути. Формат ffmpeg определяет по содержимому, поэтому
 * исходное имя здесь вообще ни на что не влияет.
 */
export function safeTmpName(filename: string): string {
  const base = path.basename(filename).replace(/[^A-Za-z0-9._-]/g, '_');
  const trimmed = base.replace(/^[._]+/, '').slice(0, 80);
  return trimmed || 'audio';
}

/**
 * Compress any audio/video buffer to a small voice-optimized MP3.
 * Mono 16kHz 32kbps → ~15 MB per hour of speech.
 * Any format ffmpeg can read (ogg, mp4, mov, webm, wav, m4a, flac, etc.) is accepted.
 * Returns the compressed Buffer.
 */
export async function compressForTranscription(buffer: Buffer, filename: string): Promise<Buffer> {
  const tmpDir = os.tmpdir();
  const id = Date.now() + '-' + Math.random().toString(36).slice(2);
  const inputPath = path.join(tmpDir, `pre-${id}-${safeTmpName(filename)}`);
  const outputPath = path.join(tmpDir, `pre-${id}.mp3`);
  fs.writeFileSync(inputPath, buffer);
  try {
    await runCommand('ffmpeg', [
      '-i', inputPath,
      '-vn',                    // drop video stream if any
      '-ac', '1',               // mono
      '-ar', '16000',           // 16 kHz (speech)
      '-q:a', '8',              // VBR ~30-40 kbps (enough for voice, avoids CBR crash)
      '-f', 'mp3',
      outputPath,
      '-y',
    ], 300000); // 5 min max
    const out = fs.readFileSync(outputPath);
    return out;
  } finally {
    try { fs.unlinkSync(inputPath); } catch {}
    try { fs.unlinkSync(outputPath); } catch {}
  }
}

/**
 * Soft compress for OpenAI Whisper API (25 MB limit).
 * Higher quality: mono 16kHz 128kbps — preserves speech clarity.
 */
export async function compressForOpenAI(buffer: Buffer, filename: string): Promise<Buffer> {
  const tmpDir = os.tmpdir();
  const id = Date.now() + '-' + Math.random().toString(36).slice(2);
  const inputPath = path.join(tmpDir, `oai-${id}-${safeTmpName(filename)}`);
  const outputPath = path.join(tmpDir, `oai-${id}.mp3`);
  fs.writeFileSync(inputPath, buffer);
  try {
    await runCommand('ffmpeg', [
      '-i', inputPath,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-q:a', '2',              // VBR ~120-150 kbps (avoids CBR crash)
      '-f', 'mp3',
      outputPath,
      '-y',
    ], 300000);
    return fs.readFileSync(outputPath);
  } finally {
    try { fs.unlinkSync(inputPath); } catch {}
    try { fs.unlinkSync(outputPath); } catch {}
  }
}

/** Run a command non-blocking. Rejects on non-zero exit or timeout. */
function runCommand(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error(`Timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Exit code ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

/** Длительность аудио в секундах через ffprobe. null, если определить не вышло. */
async function probeDurationSec(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout?.on('data', (d) => { out += d.toString(); });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve(null); }, 30000);
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', () => {
      clearTimeout(timer);
      const sec = parseFloat(out.trim());
      resolve(Number.isFinite(sec) && sec > 0 ? sec : null);
    });
  });
}

/** Длина куска, на которые режем длинное аудио перед распознаванием. */
const CHUNK_SEC = 600;

/**
 * Запас по времени на кусок: 5× от реального времени звучания.
 * `ggml-small` на CPU идёт примерно в реальном времени, но очередь пускает до
 * MAX_CONCURRENT задач разом, а whisper.cpp по умолчанию берёт 4 потока — на
 * 4-ядерном сервере это переподписка и замедление в разы. Скупой таймаут здесь
 * стоит дороже щедрого: он теряет 10 минут записи, а лишнее ожидание — только время.
 */
const CHUNK_TIMEOUT_MS = CHUNK_SEC * 5 * 1000;

/**
 * Один прогон whisper.cpp по готовому WAV. Возвращает сырой текст.
 *
 * `-mc 0` (--max-context) — ключевой флаг: по умолчанию whisper.cpp передаёт текст
 * предыдущего окна как промпт в следующее. Стоит модели один раз выдать «[Музыка]»,
 * как эта заглушка попадает в контекст и подкрепляет сама себя до конца файла.
 * С нулевым контекстом каждое окно распознаётся независимо и петля не заводится.
 */
async function runWhisper(wavPath: string, outputBase: string, timeoutMs: number): Promise<string> {
  const txtPath = outputBase + '.txt';
  await runCommand(WHISPER_CLI, [
    '-m', WHISPER_MODEL,
    '-f', wavPath,
    '-l', 'ru',
    '-mc', '0',
    '--no-timestamps',
    '-otxt',
    '-of', outputBase,
  ], timeoutMs);
  if (!fs.existsSync(txtPath)) throw new Error('Whisper output file not found');
  const text = fs.readFileSync(txtPath, 'utf-8').trim();
  try { fs.unlinkSync(txtPath); } catch {}
  return text;
}

/** Куски живут в отдельном подкаталоге — туда же смотрит и сборщик результатов. */
const CHUNK_SUBDIR = 'chunks';

/**
 * Режет WAV на куски по CHUNK_SEC секунд. Возвращает пути кусков по порядку.
 *
 * Куски пишутся в собственный подкаталог, поэтому исходник с именем вроде
 * `chunk-001.wav` не может попасть в выборку и распознаться ещё раз целиком.
 * Список собирается по каталогу, а не по коду возврата ffmpeg: если нарезка
 * оборвалась на середине, вызывающий увидит уже готовые куски и уберёт их.
 */
async function splitWav(wavPath: string, workDir: string): Promise<string[]> {
  const chunkDir = path.join(workDir, CHUNK_SUBDIR);
  fs.mkdirSync(chunkDir, { recursive: true });

  await runCommand('ffmpeg', [
    '-i', wavPath,
    '-f', 'segment',
    '-segment_time', String(CHUNK_SEC),
    // не `-c copy`: перекодирование PCM→PCM почти бесплатно, зато wav-мукс
    // гарантированно пишет корректный заголовок в каждый кусок
    '-c:a', 'pcm_s16le',
    '-reset_timestamps', '1',
    path.join(chunkDir, 'chunk-%05d.wav'),
    '-y',
  ], 300000);

  return listChunks(chunkDir);
}

/** Куски по порядку. Сортировка числовая, а не лексикографическая. */
function listChunks(chunkDir: string): string[] {
  let names: string[];
  try { names = fs.readdirSync(chunkDir); } catch { return []; }
  return names
    .filter((f) => /^chunk-\d+\.wav$/.test(f))
    .sort((a, b) => parseInt(a.slice(6), 10) - parseInt(b.slice(6), 10))
    .map((f) => path.join(chunkDir, f));
}

/**
 * Transcribe audio buffer using local whisper.cpp (FREE, no API calls).
 * ASYNC — does not block Node.js event loop, so other API requests keep flowing.
 *
 * Длинное аудио режется на куски по 10 минут и распознаётся кусок за куском:
 * сбой или деградация одного куска больше не съедает остаток записи.
 * Результат каждого куска чистится от галлюцинаций Whisper.
 */
export async function transcribeLocal(buffer: Buffer, filename: string): Promise<string> {
  // Свой каталог на задачу: снимает и коллизии имён между параллельными
  // задачами очереди, и утечку кусков — в finally уходит весь каталог целиком,
  // независимо от того, на каком шаге всё оборвалось.
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-'));

  const inputPath = path.join(workDir, `in-${safeTmpName(filename)}`);
  fs.writeFileSync(inputPath, buffer);

  const wavPath = path.join(workDir, 'audio.wav');
  const outputBase = path.join(workDir, 'out');

  try {
    // 1. Convert to WAV 16kHz mono (any format → wav via ffmpeg)
    await runCommand('ffmpeg', ['-i', inputPath, '-vn', '-ar', '16000', '-ac', '1', '-f', 'wav', wavPath, '-y'], 300000);
    try { fs.unlinkSync(inputPath); } catch {}

    const durationSec = await probeDurationSec(wavPath);

    // 2. Длинное аудио — по кускам, короткое — одним прогоном
    let chunkPaths: string[] = [];
    if (durationSec !== null && durationSec > CHUNK_SEC * 1.5) {
      try {
        chunkPaths = await splitWav(wavPath, workDir);
      } catch (err) {
        console.warn('[whisper] не удалось нарезать аудио, распознаю целиком:', err instanceof Error ? err.message : err);
        // ffmpeg мог успеть записать часть сегментов — подберём что есть
        chunkPaths = listChunks(path.join(workDir, CHUNK_SUBDIR));
      }
    }

    // Оборванная нарезка даёт меньше кусков, чем длится запись. Хвост нельзя
    // терять молча — по нему пойдёт плейсхолдер, как и по нераспознанным кускам.
    const expectedChunks = durationSec !== null ? Math.ceil(durationSec / CHUNK_SEC) : 0;
    const missingTail = chunkPaths.length > 1 ? Math.max(0, expectedChunks - chunkPaths.length) : 0;
    if (missingTail > 0) {
      console.warn(`[whisper] нарезка дала ${chunkPaths.length} кусков вместо ${expectedChunks} — хвост записи потерян`);
    }

    let transcript: string;

    if (chunkPaths.length > 1) {
      console.log(`[whisper] ${Math.round(durationSec!)}s → ${chunkPaths.length} кусков по ${CHUNK_SEC}s`);
      const parts: string[] = [];
      let recognized = 0;

      for (let i = 0; i < chunkPaths.length; i++) {
        const from = Math.round((i * CHUNK_SEC) / 60);
        const to = Math.round(((i + 1) * CHUNK_SEC) / 60);
        try {
          const rawPart = await runWhisper(chunkPaths[i]!, path.join(workDir, `out-${i}`), CHUNK_TIMEOUT_MS);
          const cleaned = sanitizeTranscript(rawPart);
          if (cleaned.loopDetected) {
            console.warn(`[whisper] кусок ${i + 1}/${chunkPaths.length}: петля-галлюцинация, вычищено ${cleaned.removedUnits} фрагментов`);
          }
          if (cleaned.text) {
            parts.push(cleaned.text);
            recognized++;
          } else {
            // Кусок вычистился в ноль — это те самые «музыка, музыка».
            // Молча выбросить нельзя: пользователь должен видеть, что 10 минут потеряны.
            parts.push(`[фрагмент ${from}–${to} мин: речь не распознана]`);
          }
        } catch (err) {
          console.error(`[whisper] кусок ${i + 1}/${chunkPaths.length} не распознан:`, err instanceof Error ? err.message : err);
          parts.push(`[фрагмент ${from}–${to} мин не распознан]`);
        } finally {
          // куски занимают столько же, сколько исходный wav — освобождаем по ходу
          try { fs.unlinkSync(chunkPaths[i]!); } catch {}
        }
      }

      if (missingTail > 0) {
        const from = Math.round((chunkPaths.length * CHUNK_SEC) / 60);
        const to = Math.round(durationSec! / 60);
        parts.push(`[фрагмент ${from}–${to} мин не обработан: нарезка аудио оборвалась]`);
      }

      if (recognized === 0) throw new Error(`ни один из ${chunkPaths.length} кусков не распознан`);
      transcript = parts.join('\n\n');
    } else {
      const total = durationSec ? Math.max(CHUNK_TIMEOUT_MS, durationSec * 5 * 1000) : 2700000;
      const raw = await runWhisper(wavPath, outputBase, total);
      const cleaned = sanitizeTranscript(raw);
      if (cleaned.loopDetected) {
        console.warn(`[whisper] петля-галлюцинация, вычищено ${cleaned.removedUnits} фрагментов`);
      }
      transcript = cleaned.text;
    }

    // 3. Финальная чистка на стыках кусков + проверка плотности речи
    transcript = sanitizeTranscript(transcript).text;
    const quality = transcriptQuality(transcript, durationSec);
    if (quality.suspicious) {
      console.warn(
        `[whisper] подозрительно мало текста: ${quality.chars} символов на ${Math.round(durationSec! / 60)} мин ` +
        `(${quality.charsPerMinute} симв/мин). Скорее всего запись слишком тихая или это не речь.`
      );
    }
    if (!transcript) throw new Error('Whisper вернул пустой результат — речь не распознана');

    // Log
    try {
      const { execute } = require('../db/db');
      await execute(
        "INSERT INTO usage_logs (type, model, detail) VALUES ($1, $2, $3)",
        ['transcription', 'whisper-local', `${transcript.length} chars, ${quality.charsPerMinute ?? '?'} cpm`]
      );
    } catch {}

    return transcript;
  } catch (err) {
    throw new Error('Whisper transcription failed: ' + (err instanceof Error ? err.message : 'unknown'), { cause: err });
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
  }
}
