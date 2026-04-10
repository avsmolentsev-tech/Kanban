import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const WHISPER_CLI = '/opt/whisper.cpp/build/bin/whisper-cli';
const WHISPER_MODEL = '/opt/whisper.cpp/models/ggml-small.bin';

/** Check if local whisper.cpp is available */
export function isLocalWhisperAvailable(): boolean {
  return fs.existsSync(WHISPER_CLI) && fs.existsSync(WHISPER_MODEL);
}

/** Transcribe audio buffer using local whisper.cpp (FREE, no API calls) */
export function transcribeLocal(buffer: Buffer, filename: string): string {
  const tmpDir = os.tmpdir();
  const id = Date.now() + '-' + Math.random().toString(36).slice(2);

  // Save buffer to temp file
  const inputPath = path.join(tmpDir, `whisper-${id}-${filename}`);
  fs.writeFileSync(inputPath, buffer);

  // Convert to WAV 16kHz mono (required by whisper.cpp)
  const wavPath = path.join(tmpDir, `whisper-${id}.wav`);
  try {
    execSync(`ffmpeg -i "${inputPath}" -ar 16000 -ac 1 -f wav "${wavPath}" -y 2>/dev/null`, { timeout: 120000 });
  } catch {
    // Cleanup
    try { fs.unlinkSync(inputPath); } catch {}
    throw new Error('Failed to convert audio to WAV');
  }

  // Run whisper.cpp
  const outputPath = path.join(tmpDir, `whisper-${id}`);
  try {
    execSync(
      `${WHISPER_CLI} -m ${WHISPER_MODEL} -f "${wavPath}" -l ru --no-timestamps -otxt -of "${outputPath}" 2>/dev/null`,
      { timeout: 600000 } // 10 min max for long audio
    );
  } catch {
    try { fs.unlinkSync(inputPath); } catch {}
    try { fs.unlinkSync(wavPath); } catch {}
    throw new Error('Whisper transcription failed');
  }

  // Read output
  const txtPath = outputPath + '.txt';
  let transcript = '';
  try {
    transcript = fs.readFileSync(txtPath, 'utf-8').trim();
  } catch {
    throw new Error('Whisper output file not found');
  }

  // Cleanup
  try { fs.unlinkSync(inputPath); } catch {}
  try { fs.unlinkSync(wavPath); } catch {}
  try { fs.unlinkSync(txtPath); } catch {}

  return transcript;
}
