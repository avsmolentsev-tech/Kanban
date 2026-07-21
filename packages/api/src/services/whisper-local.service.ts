import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const WHISPER_CLI = '/opt/whisper.cpp/build/bin/whisper-cli';
const WHISPER_MODEL = '/opt/whisper.cpp/models/ggml-small.bin';

// Shared faster-whisper microservice (see infra/transcribe-service). Preferred
// local backend — faster than whisper.cpp and shared across all projects.
const TRANSCRIBE_SERVICE_URL = process.env['TRANSCRIBE_SERVICE_URL'] || 'http://127.0.0.1:8091';

/** Check if local whisper.cpp is available */
export function isLocalWhisperAvailable(): boolean {
  return fs.existsSync(WHISPER_CLI) && fs.existsSync(WHISPER_MODEL);
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

/** One request to the faster-whisper service. Throws on non-2xx or timeout. */
async function serviceRequest(buffer: Buffer, filename: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)]), filename || 'audio');
  form.append('language', 'ru');
  const res = await fetch(`${TRANSCRIBE_SERVICE_URL}/transcribe`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(600_000), // 10 min per segment — segments are short
  });
  if (!res.ok) throw new Error(`transcribe service ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json() as { text?: string };
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
  const inputPath = path.join(tmpDir, `svc-${id}-${filename}`);
  fs.writeFileSync(inputPath, buffer);
  const segmentPaths: string[] = [];

  try {
    const duration = await probeDurationSeconds(inputPath);
    let transcript: string;

    if (duration > CHUNK_THRESHOLD_SECONDS) {
      // Split into CHUNK_SECONDS segments (stream copy → fast, frame-accurate enough).
      const pattern = path.join(tmpDir, `svc-${id}-seg-%03d.mp3`);
      await runCommand('ffmpeg', ['-i', inputPath, '-vn', '-f', 'segment', '-segment_time', String(CHUNK_SECONDS), '-c', 'copy', pattern, '-y'], 300000);
      let n = 0;
      for (;;) {
        const p = path.join(tmpDir, `svc-${id}-seg-${String(n).padStart(3, '0')}.mp3`);
        if (!fs.existsSync(p)) break;
        segmentPaths.push(p);
        n++;
      }
      if (segmentPaths.length === 0) throw new Error('segmentation produced no chunks');
      console.log(`[transcribe] ${Math.round(duration)}s → ${segmentPaths.length} segments`);

      // Transcribe with bounded concurrency, preserving order.
      const parts: string[] = new Array(segmentPaths.length).fill('');
      let next = 0;
      const worker = async (): Promise<void> => {
        for (;;) {
          const i = next++;
          if (i >= segmentPaths.length) return;
          const segBuf = fs.readFileSync(segmentPaths[i]!);
          parts[i] = await serviceRequest(segBuf, `seg-${i}.mp3`);
        }
      };
      await Promise.all(Array.from({ length: Math.min(CHUNK_CONCURRENCY, segmentPaths.length) }, () => worker()));
      transcript = parts.join(' ').replace(/\s+/g, ' ').trim();
    } else {
      transcript = await serviceRequest(buffer, filename);
    }

    try {
      const { execute } = require('../db/db');
      await execute("INSERT INTO usage_logs (type, model, detail) VALUES ($1, $2, $3)",
        ['transcription', 'faster-whisper', `${transcript.length} chars`]);
    } catch {}
    return transcript;
  } finally {
    try { fs.unlinkSync(inputPath); } catch {}
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
  const inputPath = path.join(tmpDir, `pre-${id}-${filename}`);
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
  const inputPath = path.join(tmpDir, `oai-${id}-${filename}`);
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
export async function transcribeLocal(buffer: Buffer, filename: string): Promise<string> {
  // Prefer the faster-whisper microservice; fall back to whisper.cpp if it's down.
  if (await isTranscribeServiceAvailable()) {
    try {
      return await transcribeViaService(buffer, filename);
    } catch (err) {
      console.warn('[transcribe] service failed, falling back to whisper.cpp:', err instanceof Error ? err.message : err);
    }
  }

  const tmpDir = os.tmpdir();
  const id = Date.now() + '-' + Math.random().toString(36).slice(2);

  // Save buffer to temp file
  const inputPath = path.join(tmpDir, `whisper-${id}-${filename}`);
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
    // 1. Convert to WAV 16kHz mono (any format → wav via ffmpeg)
    await runCommand('ffmpeg', ['-i', inputPath, '-vn', '-ar', '16000', '-ac', '1', '-f', 'wav', wavPath, '-y'], 300000);

    // 2. Run whisper.cpp (up to 45 min for large files)
    await runCommand(WHISPER_CLI, [
      '-m', WHISPER_MODEL,
      '-f', wavPath,
      '-l', 'ru',
      '--no-timestamps',
      '-otxt',
      '-of', outputBase,
    ], 2700000);

    // 3. Read output
    if (!fs.existsSync(txtPath)) throw new Error('Whisper output file not found');
    const transcript = fs.readFileSync(txtPath, 'utf-8').trim();

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
