import { Router, Response } from 'express';
import multer from 'multer';
import { queryAll, queryOne, execute } from '../db/db';
import { ok, fail } from '@pis/shared';
import type { AuthRequest } from '../middleware/auth';
import { getUserId } from '../middleware/user-scope';
import { compressForTranscription, transcribeLocal } from '../services/whisper-local.service';

export const transcribeRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

/** Background transcription of a standalone job (no meeting created). */
async function processTranscription(jobId: number, buffer: Buffer, filename: string): Promise<void> {
  try {
    let buf = buffer;
    try { buf = await compressForTranscription(buffer, filename); } catch { /* use original */ }
    const audioName = filename.replace(/\.[^.]+$/, '') + '.mp3';
    const text = await transcribeLocal(buf, audioName); // faster-whisper service (local, free)
    await execute('UPDATE transcriptions SET status = $1, text = $2 WHERE id = $3', ['done', text, jobId]);
  } catch (err) {
    await execute('UPDATE transcriptions SET status = $1, error = $2 WHERE id = $3',
      ['error', err instanceof Error ? err.message : 'unknown', jobId]);
  }
}

// POST /transcribe — upload audio/video, transcribe WITHOUT creating a meeting
transcribeRouter.post('/', upload.single('file'), async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (userId == null) { res.status(401).json(fail('Not authenticated')); return; }
  if (!req.file) { res.status(400).json(fail('Файл не передан')); return; }
  const filename = req.file.originalname || 'audio';
  const job = await queryOne<{ id: number }>(
    'INSERT INTO transcriptions (user_id, filename, status) VALUES ($1, $2, $3) RETURNING id',
    [userId, filename, 'processing']
  );
  const jobId = job!.id;
  // Fire-and-forget; client polls GET /transcribe/:id
  void processTranscription(jobId, req.file.buffer, filename);
  res.status(202).json(ok({ id: jobId, status: 'processing' }));
});

// GET /transcribe — recent jobs for the user
transcribeRouter.get('/', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  const rows = await queryAll(
    'SELECT id, filename, status, created_at FROM transcriptions WHERE user_id IS NOT DISTINCT FROM $1 ORDER BY id DESC LIMIT 20',
    [userId]
  );
  res.json(ok(rows));
});

// GET /transcribe/:id — status + text + summary
transcribeRouter.get('/:id', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  const id = Number(req.params['id']);
  const row = await queryOne(
    'SELECT id, filename, status, text, summary, error, created_at FROM transcriptions WHERE id = $1 AND user_id IS NOT DISTINCT FROM $2',
    [id, userId]
  );
  if (!row) { res.status(404).json(fail('Не найдено')); return; }
  res.json(ok(row));
});

// POST /transcribe/:id/summarize — structured AI summary of the transcript (no meeting)
transcribeRouter.post('/:id/summarize', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  const id = Number(req.params['id']);
  const row = await queryOne<{ text: string | null; summary: string | null }>(
    'SELECT text, summary FROM transcriptions WHERE id = $1 AND user_id IS NOT DISTINCT FROM $2', [id, userId]
  );
  if (!row) { res.status(404).json(fail('Не найдено')); return; }
  if (row.summary) { res.json(ok({ summary: row.summary })); return; }
  if (!row.text || !row.text.trim()) { res.status(400).json(fail('Нет текста для резюме')); return; }
  try {
    const { ClaudeService } = require('../services/claude.service');
    const claude = new ClaudeService();
    const sys = 'Ты редактор. Сделай структурированное резюме в markdown: ## Ключевые темы, ## Решения, ## Задачи, ## Следующие шаги. Кратко, по делу, без воды. Опирайся только на текст.';
    const summary = (await claude.chat([{ role: 'user', content: (row.text as string).slice(0, 40000) }], sys, 'gpt-4.1-mini', false, false, userId)).trim();
    await execute('UPDATE transcriptions SET summary = $1 WHERE id = $2', [summary, id]);
    res.json(ok({ summary }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Ошибка резюме'));
  }
});

// DELETE /transcribe/:id
transcribeRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  const id = Number(req.params['id']);
  await execute('DELETE FROM transcriptions WHERE id = $1 AND user_id IS NOT DISTINCT FROM $2', [id, userId]);
  res.json(ok({ deleted: true }));
});
