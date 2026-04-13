import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const WHISPER_CLI = '/opt/whisper.cpp/build/bin/whisper-cli';
const WHISPER_MODEL = '/opt/whisper.cpp/models/ggml-small.bin';

/** Check if local whisper.cpp is available */
export function isLocalWhisperAvailable(): boolean {
  return fs.existsSync(WHISPER_CLI) && fs.existsSync(WHISPER_MODEL);
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
    await runCommand('ffmpeg', ['-i', inputPath, '-ar', '16000', '-ac', '1', '-f', 'wav', wavPath, '-y'], 120000);

    // 2. Run whisper.cpp (up to 10 min)
    await runCommand(WHISPER_CLI, [
      '-m', WHISPER_MODEL,
      '-f', wavPath,
      '-l', 'ru',
      '--no-timestamps',
      '-otxt',
      '-of', outputBase,
    ], 600000);

    // 3. Read output
    if (!fs.existsSync(txtPath)) throw new Error('Whisper output file not found');
    const transcript = fs.readFileSync(txtPath, 'utf-8').trim();

    // Log
    try {
      const { getDb } = require('../db/db');
      getDb().prepare("INSERT INTO usage_logs (type, model, detail) VALUES (?, ?, ?)").run(
        'transcription', 'whisper-local', `${transcript.length} chars`
      );
    } catch {}

    return transcript;
  } catch (err) {
    throw new Error('Whisper transcription failed: ' + (err instanceof Error ? err.message : 'unknown'));
  } finally {
    cleanup();
  }
}
