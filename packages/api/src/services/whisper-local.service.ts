import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import * as crypto from 'crypto';
import { sanitizeTranscript, transcriptQuality } from './transcript-sanitize';

const WHISPER_CLI = '/opt/whisper.cpp/build/bin/whisper-cli';
const WHISPER_MODEL = '/opt/whisper.cpp/models/ggml-small.bin';

// Shared faster-whisper microservice (see infra/transcribe-service). Preferred
// local backend — faster than whisper.cpp and shared across all projects.
const TRANSCRIBE_SERVICE_URL = process.env['TRANSCRIBE_SERVICE_URL'] || 'http://127.0.0.1:8091';

/** Check if local whisper.cpp is available */
export function isLocalWhisperAvailable(): boolean {
  return fs.existsSync(WHISPER_CLI) && fs.existsSync(WHISPER_MODEL);
}

/**
 * Фильтр обрезки тишины для ffmpeg.
 * Whisper на длинной тишине выдумывает текст («Музыка», «Продолжение следует»),
 * поэтому паузы режутся ДО распознавания, а не чистятся после.
 * stop_duration=1.5 — короткие паузы в речи сохраняются, схлопываются только длинные.
 */
export function buildSilenceFilter(): string {
  return 'silenceremove=start_periods=1:start_duration=0.3:start_threshold=-45dB:' +
    'stop_periods=-1:stop_duration=1.5:stop_threshold=-45dB';
}

/**
 * Подпись пропавшего сегмента при отправке в faster-whisper.
 * Раньше здесь указывались минуты записи (индекс сегмента × CHUNK_SECONDS) —
 * это было честно, пока сегментирование шло по исходному аудио. Теперь оно
 * идёт по аудио ПОСЛЕ обрезки тишины: `silenceremove` с `stop_periods=-1`
 * схлопывает все паузы длиннее 1.5с, а не только по краям, поэтому минута по
 * номеру сегмента больше не совпадает с минутой в исходной записи — тем
 * сильнее, чем больше в записи пауз. Номер фрагмента честен всегда.
 */
export function formatSegmentFailure(index: number, total: number): string {
  return `[фрагмент ${index + 1} из ${total} не распознан]`;
}

/**
 * Обеззараживает имя загруженного файла перед подстановкой в путь.
 *
 * `req.file.originalname` приходит от клиента как есть, multer его не трогает.
 * `path.join('/tmp', 'svc-1-' + '../../../etc/cron.d/x')` схлопывается в
 * `/etc/cron.d/x`: первый `..` съедает литеральный сегмент `svc-1-..`, остальные
 * выводят за пределы /tmp — и буфер пишется (а в finally удаляется) по
 * произвольному пути. Формат ffmpeg определяет по содержимому, поэтому исходное
 * имя здесь ни на что не влияет.
 */
export function safeTmpName(filename: string): string {
  const base = path.basename(filename || '').replace(/[^A-Za-z0-9._-]/g, '_');
  return base.replace(/^[._]+/, '').slice(0, 80) || 'audio';
}

/** Is the faster-whisper microservice healthy? (short timeout, never throws) */
export async function isTranscribeServiceAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${TRANSCRIBE_SERVICE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

// Long files are split into segments so (a) each HTTP request finishes well within
// undici's ~5-min headers timeout, and (b) one bad segment can't sink the whole file.
const CHUNK_SECONDS = 300;          // 5-min segments
const CHUNK_THRESHOLD_SECONDS = 480; // only split files longer than 8 min
const CHUNK_CONCURRENCY = 2;         // matches the service's MAX_CONCURRENCY

/**
 * Потолок ожидания одного сегмента. Это таймаут бездействия сокета, а не общего
 * времени: пока сервис считает, байты не идут, поэтому запас берём с большим полем.
 */
const SEGMENT_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * POST multipart через node:http.
 *
 * Здесь намеренно НЕ используется fetch. У undici, на котором построен
 * глобальный fetch, есть собственный `headersTimeout` — 300 секунд по умолчанию,
 * и снаружи он настраивается только через `dispatcher`, то есть через пакет
 * `undici`, которого в зависимостях нет. Сервис транскрибации общий на все
 * проекты сервера и держит `MAX_CONCURRENCY=2`, поэтому под нагрузкой сегмент
 * ждёт своей очереди дольше пяти минут — и undici убивает запрос с безликим
 * `TypeError: fetch failed` ещё до того, как сработает `AbortSignal.timeout`.
 * Именно так часовая запись теряла все сегменты разом и уезжала в фолбэк на
 * whisper.cpp, где превращалась в петлю «Музыка. Музыка. Музыка».
 * У node:http скрытого таймаута заголовков нет — временем управляем мы.
 */
function postMultipart(
  url: string,
  fileBuffer: Buffer,
  filename: string,
  fields: Record<string, string>,
  timeoutMs: number,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const boundary = '----clarity' + crypto.randomBytes(16).toString('hex');

    const head: Buffer[] = [];
    for (const [name, value] of Object.entries(fields)) {
      head.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    }
    head.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeTmpName(filename)}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`
    ));
    const body = Buffer.concat([...head, fileBuffer, Buffer.from(`\r\n--${boundary}--\r\n`)]);

    const req = http.request({
      hostname: target.hostname,
      port: target.port || 80,
      path: target.pathname + target.search,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') }));
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`no response within ${Math.round(timeoutMs / 1000)}s`));
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** One request to the faster-whisper service. Throws on non-2xx or timeout. */
async function serviceRequest(buffer: Buffer, filename: string): Promise<string> {
  const { status, body } = await postMultipart(
    `${TRANSCRIBE_SERVICE_URL}/transcribe`,
    buffer,
    filename || 'audio',
    { language: 'ru' },
    SEGMENT_TIMEOUT_MS,
  );
  if (status < 200 || status >= 300) throw new Error(`transcribe service ${status}: ${body.slice(0, 200)}`);
  const data = JSON.parse(body) as { text?: string };
  return (data.text ?? '').trim();
}

/** Probe audio duration in seconds via ffprobe (0 if unknown). */
async function probeDurationSeconds(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', filePath]);
    let out = '';
    child.stdout?.on('data', (d) => { out += d.toString(); });
    child.on('error', () => resolve(0));
    child.on('close', () => resolve(parseFloat(out.trim()) || 0));
  });
}

/**
 * Transcribe via the faster-whisper microservice. Splits long recordings into
 * short segments (concurrency-limited) and joins the results in order.
 */
export async function transcribeViaService(buffer: Buffer, filename: string): Promise<string> {
  const tmpDir = os.tmpdir();
  const id = Date.now() + '-' + Math.random().toString(36).slice(2);
  const inputPath = path.join(tmpDir, `svc-${id}-${safeTmpName(filename)}`);
  fs.writeFileSync(inputPath, buffer);
  const segmentPaths: string[] = [];

  // Обрезаем тишину ОДНИМ проходом ffmpeg на весь файл, до сегментирования —
  // если резать внутри каждого сегмента, границы кусков поедут и склейка по
  // порядку сломается. Один процесс на файл, не на сегмент: сервер общий,
  // рядом крутится ещё десяток чужих продуктов на 4 ядрах.
  // Тишина — оптимизация качества, а не обязательное условие: если ffmpeg на
  // этом файле упал, едем дальше на исходном аудио, а не роняем расшифровку.
  const trimmedPath = path.join(tmpDir, `svc-${id}-trimmed.mp3`);
  let workPath = inputPath;
  let workFilename = filename;
  try {
    await runCommand('ffmpeg', [
      '-i', inputPath, '-vn',
      '-af', buildSilenceFilter(),
      '-ar', '16000', '-ac', '1', '-q:a', '6',
      trimmedPath, '-y',
    ], 300000);
    if (fs.existsSync(trimmedPath)) {
      workPath = trimmedPath;
      // .replace(/\.[^.]+$/, ...) не трогает имя без расширения вообще (нет
      // литерального совпадения) — .mp3 нужно ДОБАВИТЬ всегда, а не только
      // заменить существующее расширение.
      workFilename = filename.replace(/\.[^./]+$/, '') + '.mp3';
    }
  } catch (err) {
    console.warn('[transcribe] обрезка тишины не удалась, используем исходное аудио:', err instanceof Error ? err.message : err);
    try { fs.unlinkSync(trimmedPath); } catch {}
  }

  try {
    const duration = await probeDurationSeconds(workPath);
    let transcript: string;

    if (duration > CHUNK_THRESHOLD_SECONDS) {
      // Split into CHUNK_SECONDS segments (stream copy → fast, frame-accurate enough).
      const pattern = path.join(tmpDir, `svc-${id}-seg-%03d.mp3`);
      await runCommand('ffmpeg', ['-i', workPath, '-vn', '-f', 'segment', '-segment_time', String(CHUNK_SECONDS), '-c', 'copy', pattern, '-y'], 300000);
      let n = 0;
      for (;;) {
        const p = path.join(tmpDir, `svc-${id}-seg-${String(n).padStart(3, '0')}.mp3`);
        if (!fs.existsSync(p)) break;
        segmentPaths.push(p);
        n++;
      }
      if (segmentPaths.length === 0) throw new Error('segmentation produced no chunks');
      console.log(`[transcribe] ${Math.round(duration)}s → ${segmentPaths.length} segments`);

      // Transcribe with bounded concurrency, preserving order. Segment failures are
      // tolerated (retry once, then skip) so one timed-out chunk under load can't sink
      // the whole recording — we keep every segment that succeeded.
      const parts: string[] = new Array(segmentPaths.length).fill('');
      let next = 0;
      let failed = 0;
      const worker = async (): Promise<void> => {
        for (;;) {
          const i = next++;
          if (i >= segmentPaths.length) return;
          const segBuf = fs.readFileSync(segmentPaths[i]!);
          let done = false;
          for (let attempt = 0; attempt < 2 && !done; attempt++) {
            try {
              parts[i] = await serviceRequest(segBuf, `seg-${i}.mp3`);
              done = true;
            } catch (err) {
              if (attempt === 0) {
                // Пауза перед повтором: если сервис занят чужой задачей, мгновенный
                // ретрай просто встаёт в ту же очередь и падает следом за первым.
                await new Promise((r) => setTimeout(r, 15000));
                continue;
              }
              failed++;
              console.warn(`[transcribe] segment ${i}/${segmentPaths.length} failed:`, err instanceof Error ? err.message : err);
              // Потерянный фрагмент помечаем прямо в тексте. Молчаливый пропуск читается
              // как «здесь ничего не говорили» — а на деле кусок записи просто выпал.
              parts[i] = formatSegmentFailure(i, segmentPaths.length);
            }
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(CHUNK_CONCURRENCY, segmentPaths.length) }, () => worker()));
      // Only give up (→ whisper.cpp fallback) if EVERY segment failed. Any partial
      // transcript is more useful than none.
      if (failed >= segmentPaths.length) throw new Error(`all ${segmentPaths.length} segments failed`);
      if (failed > 0) console.warn(`[transcribe] ${failed}/${segmentPaths.length} segments dropped, returning partial transcript`);
      transcript = parts.join(' ').replace(/\s+/g, ' ').trim();
    } else {
      // Короткий файл шлём одним запросом. Если тишина обрезалась — читаем
      // результат прохода ffmpeg, иначе экономим лишний диск-I/O и берём
      // буфер, который уже есть в памяти.
      const shortAudio = workPath === trimmedPath ? fs.readFileSync(trimmedPath) : buffer;
      transcript = await serviceRequest(shortAudio, workFilename);
    }

    try {
      const { execute } = require('../db/db');
      await execute("INSERT INTO usage_logs (type, model, detail) VALUES ($1, $2, $3)",
        ['transcription', 'faster-whisper', `${transcript.length} chars`]);
    } catch {}
    return transcript;
  } finally {
    try { fs.unlinkSync(inputPath); } catch {}
    if (workPath === trimmedPath) { try { fs.unlinkSync(trimmedPath); } catch {} }
    for (const p of segmentPaths) { try { fs.unlinkSync(p); } catch {} }
  }
}

// Speech loudness normalization (EBU R128). Brings quiet AND loud recordings to a
// consistent target WITHOUT clipping — replaces the old raw "+12 dB" boost, which
// saturated normal-volume audio into distortion (whisper then heard only noise).
// highpass trims low rumble; loudnorm does the leveling with a true-peak ceiling.
const SPEECH_NORMALIZE_FILTER = 'highpass=f=80,loudnorm=I=-16:TP=-1.5:LRA=11';

/**
 * Compress any audio/video buffer to a small voice-optimized MP3.
 * Mono 16kHz + loudness-normalized → ~15 MB per hour of speech, no clipping.
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
      '-vn',                        // drop video stream if any
      '-af', SPEECH_NORMALIZE_FILTER, // level to a consistent target, no clipping
      '-ac', '1',                   // mono
      '-ar', '16000',               // 16 kHz (speech)
      '-q:a', '8',                  // VBR ~30-40 kbps (enough for voice, avoids CBR crash)
      '-f', 'mp3',
      outputPath,
      '-y',
    ], 900000); // 15 min max (loudnorm on long files is slower than a plain copy)
    const out = fs.readFileSync(outputPath);
    return out;
  } finally {
    try { fs.unlinkSync(inputPath); } catch {}
    try { fs.unlinkSync(outputPath); } catch {}
  }
}

/**
 * Detect whisper garbage — the hallucination loops it emits on unintelligible audio
 * (e.g. "что то у меня не в смысле" repeated hundreds of times). Returns true when the
 * transcript is almost certainly not real speech, so callers can flag it instead of
 * confidently summarizing noise.
 */
export function looksLikeGarbage(text: string): boolean {
  const t = (text || '').trim();
  if (t.length < 40) return false; // too short to judge; leave it alone

  const words = t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  if (words.length < 20) return false;

  // 1) Very low vocabulary diversity → looping phrase.
  const unique = new Set(words);
  if (unique.size / words.length < 0.12) return true;

  // 2) A short window repeated back-to-back many times (e.g. 4-gram looping).
  const gram = 4;
  const counts = new Map<string, number>();
  for (let i = 0; i + gram <= words.length; i++) {
    const key = words.slice(i, i + gram).join(' ');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let maxRepeat = 0;
  for (const c of counts.values()) if (c > maxRepeat) maxRepeat = c;
  const windows = Math.max(1, words.length - gram + 1);
  if (maxRepeat / windows > 0.3) return true;

  return false;
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

/**
 * Transcribe audio buffer using local whisper.cpp (FREE, no API calls).
 * ASYNC — does not block Node.js event loop, so other API requests keep flowing.
 */
/**
 * Сообщает, что расшифровка идёт на запасной, заметно более слабой модели.
 * Шлётся не чаще раза в час, чтобы серия загрузок не превратилась в спам.
 */
let lastDegradedNotice = 0;
function notifyDegraded(reason: string): void {
  console.warn(`[transcribe] ДЕГРАДАЦИЯ: ${reason}. Использую whisper.cpp (модель small) — качество будет заметно хуже.`);
  const HOUR = 3600_000;
  const now = Date.now();
  if (now - lastDegradedNotice < HOUR) return;
  lastDegradedNotice = now;
  try {
    const { telegramService } = require('./telegram.service');
    void telegramService.notify(
      `⚠️ <b>Транскрибация деградировала</b>\n${reason}\n\nИдёт запасной путь whisper.cpp (small), качество хуже. Проверь контейнер transcribe-service.`
    );
  } catch {}
}

export async function transcribeLocal(buffer: Buffer, filename: string): Promise<string> {
  // Prefer the faster-whisper microservice; fall back to whisper.cpp if it's down.
  const serviceUp = await isTranscribeServiceAvailable();
  if (serviceUp) {
    try {
      return await transcribeViaService(buffer, filename);
    } catch (err) {
      console.warn('[transcribe] service failed, falling back to whisper.cpp:', err instanceof Error ? err.message : err);
      notifyDegraded('микросервис ответил ошибкой: ' + (err instanceof Error ? err.message : 'unknown'));
    }
  } else {
    // Тихая деградация на слабую модель однажды стоила четырёх дней плохих
    // расшифровок: снаружи всё выглядело работающим. Теперь про это узнают.
    notifyDegraded('микросервис faster-whisper не отвечает (' + TRANSCRIBE_SERVICE_URL + ')');
  }

  const tmpDir = os.tmpdir();
  const id = Date.now() + '-' + Math.random().toString(36).slice(2);

  // Save buffer to temp file
  const inputPath = path.join(tmpDir, `whisper-${id}-${safeTmpName(filename)}`);
  fs.writeFileSync(inputPath, buffer);

  const wavPath = path.join(tmpDir, `whisper-${id}.wav`);
  const outputBase = path.join(tmpDir, `whisper-${id}`);
  const txtPath = outputBase + '.txt';

  const cleanup = (): void => {
    for (const p of [inputPath, wavPath, txtPath]) {
      try { fs.unlinkSync(p); } catch {}
    }
  };

  try {
    // 1. Convert to WAV 16kHz mono (any format → wav via ffmpeg), обрезая тишину
    await runCommand('ffmpeg', [
      '-i', inputPath, '-vn',
      '-af', buildSilenceFilter(),
      '-ar', '16000', '-ac', '1', '-f', 'wav', wavPath, '-y',
    ], 300000);

    // 2. Run whisper.cpp (up to 45 min for large files)
    await runCommand(WHISPER_CLI, [
      '-m', WHISPER_MODEL,
      '-f', wavPath,
      '-l', 'ru',
      // По умолчанию whisper.cpp тащит текст предыдущего окна промптом в следующее.
      // Стоит модели раз выдать «[Музыка]», как заглушка подкрепляет сама себя до
      // конца файла — именно так фолбэк 13.08 съел половину полуторачасовой записи.
      '-mc', '0',
      '--no-timestamps',
      '-otxt',
      '-of', outputBase,
    ], 2700000);

    // 3. Read output
    if (!fs.existsSync(txtPath)) throw new Error('Whisper output file not found');
    const raw = fs.readFileSync(txtPath, 'utf-8').trim();

    // whisper.cpp на нераспознаваемом участке скатывается в петлю из служебных
    // меток. `-mc 0` не даёт ей заводиться, чистка убирает то, что всё же прошло.
    const cleaned = sanitizeTranscript(raw);
    if (cleaned.loopDetected) {
      console.warn(`[transcribe] петля-галлюцинация в фолбэке, вычищено ${cleaned.removedUnits} фрагментов`);
    }
    const transcript = cleaned.text;

    // Плотность речи: слишком мало символов на минуту — распознавание провалилось,
    // даже если текст на вид приличный. Именно этой проверки не хватило 10 августа.
    const durationSec = await probeDurationSeconds(wavPath);
    const quality = transcriptQuality(transcript, durationSec || null);
    if (quality.suspicious) {
      console.warn(
        `[transcribe] подозрительно мало текста: ${quality.chars} символов на ` +
        `${Math.round(durationSec / 60)} мин (${quality.charsPerMinute} симв/мин)`
      );
      notifyDegraded(`распознано всего ${quality.charsPerMinute} симв/мин при норме ~700 — вероятна потеря содержимого`);
    }

    // Log
    try {
      const { execute } = require('../db/db');
      await execute(
        "INSERT INTO usage_logs (type, model, detail) VALUES ($1, $2, $3)",
        ['transcription', 'whisper-local', `${transcript.length} chars`]
      );
    } catch {}

    return transcript;
  } catch (err) {
    throw new Error('Whisper transcription failed: ' + (err instanceof Error ? err.message : 'unknown'));
  } finally {
    cleanup();
  }
}
