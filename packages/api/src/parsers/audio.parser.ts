import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import OpenAI from 'openai';
import { config } from '../config';
import { assertCloudFallbackAllowed } from '../services/transcription-policy';

const openai = new OpenAI({ apiKey: config.openaiApiKey, baseURL: config.openaiBaseUrl });

export async function parseAudio(buffer: Buffer, ext: string): Promise<string> {
  // 152-ФЗ: этот путь (загрузка аудио через /v1/ingest) всегда шёл в облачный OpenAI
  // whisper-1 напрямую — здесь нет локальной альтернативы, поэтому при запрете
  // облачного фолбэка политикой этот путь просто недоступен, а не молча игнорирует флаг.
  assertCloudFallbackAllowed(config.transcriptionAllowCloudFallback, 'Загрузка аудио через /v1/ingest не имеет локальной альтернативы OpenAI whisper-1');
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
