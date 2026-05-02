type TranscribeJob = {
  id: string;
  buffer: Buffer;
  filename: string;
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  addedAt: number;
};

const MAX_CONCURRENT = 2; // max local whisper processes at once
let activeCount = 0;
const queue: TranscribeJob[] = [];

export async function queueTranscription(buffer: Buffer, filename: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const job: TranscribeJob = {
      id: Math.random().toString(36).slice(2),
      buffer,
      filename,
      resolve,
      reject,
      addedAt: Date.now(),
    };

    if (activeCount < MAX_CONCURRENT) {
      processJob(job);
    } else {
      queue.push(job);
      console.log(`[whisper-queue] job ${job.id} queued, position ${queue.length}, active: ${activeCount}`);
    }
  });
}

export function getQueueStatus(): { active: number; queued: number } {
  return { active: activeCount, queued: queue.length };
}

async function processJob(job: TranscribeJob): Promise<void> {
  activeCount++;
  console.log(`[whisper-queue] processing job ${job.id}, active: ${activeCount}, queued: ${queue.length}`);

  try {
    const { isLocalWhisperAvailable, transcribeLocal, compressForTranscription } = require('./whisper-local.service');

    // Pre-compress large files
    let audioBuffer = job.buffer;
    let audioFilename = job.filename;
    const sizeMb = audioBuffer.length / (1024 * 1024);
    if (sizeMb > 10) {
      try {
        console.log(`[whisper-queue] pre-compressing ${Math.round(sizeMb)}MB`);
        audioBuffer = await compressForTranscription(audioBuffer, audioFilename);
        audioFilename = audioFilename.replace(/\.[^.]+$/, '.mp3');
        console.log(`[whisper-queue] compressed → ${Math.round(audioBuffer.length / (1024 * 1024))}MB`);
      } catch {}
    }

    if (isLocalWhisperAvailable()) {
      const text = await transcribeLocal(audioBuffer, audioFilename);
      job.resolve(text);
    } else {
      // No local whisper — use OpenAI directly
      const text = await transcribeWithOpenAI(audioBuffer, audioFilename);
      job.resolve(text);
    }
  } catch (err) {
    // Local whisper failed — try OpenAI as fallback
    console.warn(`[whisper-queue] local failed for job ${job.id}, trying OpenAI:`, err instanceof Error ? err.message : err);
    try {
      const text = await transcribeWithOpenAI(job.buffer, job.filename);
      job.resolve(text);
    } catch (err2) {
      job.reject(err2 instanceof Error ? err2 : new Error(String(err2)));
    }
  } finally {
    activeCount--;
    // Process next in queue
    if (queue.length > 0) {
      const next = queue.shift()!;
      console.log(`[whisper-queue] dequeuing job ${next.id}, waited ${Math.round((Date.now() - next.addedAt) / 1000)}s`);
      processJob(next);
    }
  }
}

export async function transcribeWithOpenAI(buffer: Buffer, filename: string): Promise<string> {
  const OpenAI = require('openai').default;
  const { config } = require('../config');
  console.log('[whisper-queue] using OpenAI API');
  const openai = new OpenAI({ apiKey: config.openaiApiKey });

  // Soft compress only if over 24 MB (OpenAI limit 25 MB)
  // Uses 128 kbps stereo — much better quality than local whisper's 32 kbps mono
  let audioBuffer = buffer;
  let audioFilename = filename;
  const sizeMb = buffer.length / (1024 * 1024);
  if (sizeMb > 24) {
    try {
      const { compressForOpenAI } = require('./whisper-local.service');
      audioBuffer = await compressForOpenAI(buffer, filename);
      audioFilename = filename.replace(/\.[^.]+$/, '.mp3');
      console.log(`[whisper-queue] compressed ${Math.round(sizeMb)}MB → ${Math.round(audioBuffer.length / (1024 * 1024))}MB for OpenAI`);
    } catch {}
  }

  const file = new File([audioBuffer], audioFilename, { type: 'audio/mpeg' });
  const result = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file,
    language: 'ru',
  });
  return result.text;
}

// For overflow: if queue is long, route directly to OpenAI
export async function transcribeWithOverflow(buffer: Buffer, filename: string): Promise<string> {
  const status = getQueueStatus();

  // If queue has 3+ jobs waiting, skip local whisper and go straight to OpenAI
  if (status.queued >= 3) {
    console.log(`[whisper-queue] queue overflow (${status.queued} waiting), routing to OpenAI directly`);
    return transcribeWithOpenAI(buffer, filename);
  }

  return queueTranscription(buffer, filename);
}
