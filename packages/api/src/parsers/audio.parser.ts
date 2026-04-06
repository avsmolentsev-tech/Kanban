import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import OpenAI from 'openai';
import { config } from '../config';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

export async function parseAudio(buffer: Buffer, ext: string): Promise<string> {
  // Write buffer to temp file (Whisper API requires a file)
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `pis-audio-${Date.now()}.${ext}`);

  try {
    fs.writeFileSync(tmpFile, buffer);

    const transcription = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file: fs.createReadStream(tmpFile),
    });

    return transcription.text;
  } finally {
    // Clean up temp file
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}
