type TranscribeJob = {
  id: string;
  buffer: Buffer;
  filename: string;
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  addedAt: number;
};

const MAX_CONCURRENT = 4; // max local whisper processes at once (optimized for 4-core server)
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

    // Always boost audio first for better recognition
    let audioBuffer = await boostAudio(job.buffer, job.filename);
    let audioFilename = job.filename.replace(/\.[^.]+$/, '.mp3');

    // Pre-compress large files
    const sizeMb = audioBuffer.length / (1024 * 1024);
    if (sizeMb > 10) {
      try {
        console.log(`[whisper-queue] pre-compressing ${Math.round(sizeMb)}MB`);
        audioBuffer = await compressForTranscription(audioBuffer, audioFilename);
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

/** Boost quiet audio with ffmpeg before transcription */
async function boostAudio(buffer: Buffer, filename: string): Promise<Buffer> {
  const { execFile } = require('child_process');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const tmpIn = path.join(os.tmpdir(), `whisper-in-${Date.now()}${path.extname(filename) || '.mp3'}`);
  const tmpOut = path.join(os.tmpdir(), `whisper-out-${Date.now()}.mp3`);
  fs.writeFileSync(tmpIn, buffer);
  return new Promise<Buffer>((resolve) => {
    execFile('ffmpeg', [
      '-y', '-i', tmpIn,
      '-vn',
      '-af', 'volume=12dB,highpass=f=100,lowpass=f=8000',
      '-ar', '16000', '-ac', '1', '-q:a', '6',
      tmpOut,
    ], { timeout: 300000 }, (err: Error | null, _stdout: string, stderr: string) => {
      try { fs.unlinkSync(tmpIn); } catch {}
      if (err || !fs.existsSync(tmpOut)) {
        console.warn('[whisper-queue] audio boost failed, using original.', err?.message || '', stderr?.slice(0, 200) || '');
        resolve(buffer);
        return;
      }
      const boosted = fs.readFileSync(tmpOut);
      try { fs.unlinkSync(tmpOut); } catch {}
      console.log(`[whisper-queue] audio boosted: ${Math.round(buffer.length/1024)}KB → ${Math.round(boosted.length/1024)}KB`);
      resolve(boosted);
    });
  });
}

export async function transcribeWithOpenAI(buffer: Buffer, filename: string): Promise<string> {
  const OpenAI = require('openai').default;
  const { config } = require('../config');
  console.log('[whisper-queue] using OpenAI API');
  const openai = new OpenAI({ apiKey: config.openaiApiKey, baseURL: config.openaiBaseUrl });

  // Always boost audio for better recognition of quiet recordings
  let audioBuffer = await boostAudio(buffer, filename);
  let audioFilename = filename.replace(/\.[^.]+$/, '.mp3');

  // Compress if over 24 MB (OpenAI limit 25 MB)
  const sizeMb = audioBuffer.length / (1024 * 1024);
  if (sizeMb > 24) {
    try {
      const { compressForOpenAI } = require('./whisper-local.service');
      audioBuffer = await compressForOpenAI(audioBuffer, audioFilename);
      console.log(`[whisper-queue] compressed ${Math.round(sizeMb)}MB → ${Math.round(audioBuffer.length / (1024 * 1024))}MB for OpenAI`);
    } catch {}
  }

  const file = new File([audioBuffer], audioFilename, { type: 'audio/mpeg' });
  const result = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file,
    language: 'ru',
  });

  // whisper-1 тоже скатывается в петлю «Музыка / Продолжение следует...» на тихих участках
  const { sanitizeTranscript } = require('./transcript-sanitize');
  const cleaned = sanitizeTranscript(result.text);
  if (cleaned.loopDetected) {
    console.warn(`[whisper-queue] OpenAI: петля-галлюцинация, вычищено ${cleaned.removedUnits} фрагментов`);
  }
  return cleaned.text;
}

// Plan-aware transcription: pro_max → OpenAI directly (fast), free → local queue
export async function transcribeForUser(buffer: Buffer, filename: string, userId: number): Promise<string> {
  const { shouldUseFastTranscription } = require('../middleware/plan');
  const useFast = await shouldUseFastTranscription(userId);
  if (useFast) {
    console.log(`[whisper-queue] user ${userId} is pro_max, using OpenAI directly`);
    return transcribeWithOpenAI(buffer, filename);
  }
  return queueTranscription(buffer, filename);
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
