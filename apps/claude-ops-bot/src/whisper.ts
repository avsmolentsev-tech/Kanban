import { transcribeLocal, isLocalWhisperAvailable } from './whisper-local.service.js';

export async function transcribe(buffer: Buffer, filename: string): Promise<string> {
  if (!isLocalWhisperAvailable()) throw new Error('Whisper not available on this host');
  return transcribeLocal(buffer, filename);
}
