import { Router, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import * as fs from 'fs';
import * as path from 'path';
import { queryAll, queryOne, execute } from '../db/db';
import { ok, fail } from '@pis/shared';
import { searchService } from '../services/search.service';
import { ObsidianService } from '../services/obsidian.service';
import { ClaudeService, PII_TOKEN_NOTE } from '../services/claude.service';
import { mdToPdf, mdToDocx } from '../services/converter.service';
import { telegramService } from '../services/telegram.service';
import { isLocalWhisperAvailable, isTranscribeServiceAvailable, transcribeLocal, compressForTranscription, looksLikeGarbage, safeTmpName } from '../services/whisper-local.service';
import { redactPii, restorePiiAndWarn, joinForRedaction, splitRedacted } from '../services/pii-redact';
import { assertCloudFallbackAllowed } from '../services/transcription-policy';
import { config } from '../config';
import { registerJob, completeJob, resumePendingJobs, type PendingJob } from '../services/pending-jobs';
import OpenAI from 'openai';
import type { AuthRequest } from '../middleware/auth';
import { getUserId, userScopeWhere } from '../middleware/user-scope';

const obsidian = new ObsidianService(config.vaultPath);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } }); // 500MB for video files
const openai = new OpenAI({ apiKey: config.openaiApiKey, baseURL: config.openaiBaseUrl });
const claude = new ClaudeService();

// 152-ФЗ: единый системный промпт для всех путей резюмирования встречи (авто- и
// ручное — «Сделать резюме», экспорт в Telegram/скачивание) с явной инструкцией
// про плейсхолдеры redactPii — без неё модель, пишущая связное резюме, склонна
// пересказывать «[УЧАСТНИК_1]» как «Участник 1», и restorePii ничего не находит.
const SUMMARY_SYS_PROMPT = `Ты редактор. Сделай структурированное резюме встречи в markdown: ## Ключевые решения, ## Договорённости, ## Задачи, ## Следующие шаги. 200-500 слов, по делу, без воды. ${PII_TOKEN_NOTE}`;
const COMPACT_SUMMARY_SYS_PROMPT = `Ты редактор. Сделай компактное структурированное резюме встречи в markdown: цели, ключевые решения, договорённости, задачи, следующие шаги. 200-500 слов, без воды. ${PII_TOKEN_NOTE}`;

export const meetingsRouter = Router();

const CreateSchema = z.object({
  title: z.string().min(1),
  date: z.string(),
  project_id: z.number().int().optional(),
  project_ids: z.array(z.number().int()).optional(),
  summary_raw: z.string().default(''),
  sync_vault: z.boolean().optional(),
});
const UpdateSchema = z.object({
  title: z.string().min(1).optional(),
  date: z.string().optional(),
  project_id: z.number().int().nullable().optional(),
  project_ids: z.array(z.number().int()).optional(),
  person_ids: z.array(z.number().int()).optional(),
  sync_vault: z.boolean().optional(),
  summary_raw: z.string().optional(),
  meeting_type: z.enum(['meeting', 'lecture', 'interview']).optional(),
});

async function attachProjects(meetings: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  if (meetings.length === 0) return meetings;
  const ids = meetings.map(m => m['id']);
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
  const rows = await queryAll<{ meeting_id: number; id: number; name: string; color: string }>(`
    SELECT mp.meeting_id, p.id, p.name, p.color
    FROM meeting_projects mp JOIN projects p ON p.id = mp.project_id
    WHERE mp.meeting_id IN (${placeholders})
  `, ids);
  const byMeeting = new Map<number, Array<{ id: number; name: string; color: string }>>();
  for (const r of rows) {
    if (!byMeeting.has(r.meeting_id)) byMeeting.set(r.meeting_id, []);
    byMeeting.get(r.meeting_id)!.push({ id: r.id, name: r.name, color: r.color });
  }
  return meetings.map(m => {
    const projects = byMeeting.get(m['id'] as number) ?? [];
    return { ...m, projects, project_ids: projects.map(p => p.id) };
  });
}

async function setMeetingProjects(meetingId: number, projectIds: number[]): Promise<void> {
  await execute('DELETE FROM meeting_projects WHERE meeting_id = $1', [meetingId]);
  for (const pid of projectIds) {
    await execute('INSERT INTO meeting_projects (meeting_id, project_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [meetingId, pid]);
  }
  // Keep legacy project_id in sync with first
  await execute('UPDATE meetings SET project_id = $1 WHERE id = $2', [projectIds[0] ?? null, meetingId]);
}

meetingsRouter.get('/', async (req: AuthRequest, res: Response) => {
  const scope = userScopeWhere(req);
  let sql = 'SELECT DISTINCT m.* FROM meetings m';
  const params: unknown[] = [];
  if (req.query['project']) {
    params.push(Number(req.query['project']), Number(req.query['project']));
    const scopeOffset = params.length;
    const scopeSql = scope.sql.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + scopeOffset}`);
    sql += ` LEFT JOIN meeting_projects mp ON mp.meeting_id = m.id WHERE (m.project_id = $1 OR mp.project_id = $2) AND ${scopeSql}`;
    params.push(...scope.params);
  } else {
    sql += ` WHERE ${scope.sql}`;
    params.push(...scope.params);
  }
  if (req.query['from']) { sql += ` AND m.date >= $${params.length + 1}`; params.push(req.query['from']); }
  if (req.query['to']) { sql += ` AND m.date <= $${params.length + 1}`; params.push(req.query['to']); }
  sql += ' ORDER BY m.date DESC';
  const meetings = await queryAll<Record<string, unknown>>(sql, params);
  res.json(ok(await attachProjects(meetings)));
});

meetingsRouter.post('/', async (req: AuthRequest, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { title, date, project_id, project_ids, summary_raw, sync_vault } = parsed.data;
  const effectiveIds = project_ids && project_ids.length > 0 ? project_ids : project_id != null ? [project_id] : [];
  const shouldSync = sync_vault !== false;
  const userId = getUserId(req);
  const inserted = await queryOne<{ id: number }>(
    'INSERT INTO meetings (title, date, project_id, summary_raw, user_id, sync_vault) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [title, date, effectiveIds[0] ?? null, summary_raw, userId, shouldSync ? 1 : 0]
  );
  const meetingId = inserted!.id;
  if (effectiveIds.length > 0) await setMeetingProjects(meetingId, effectiveIds);
  searchService.indexRecord('meeting', meetingId, title, summary_raw);
  // Sync to vault (only if enabled)
  if (shouldSync) {
    try {
      const projectName = effectiveIds[0] ? (await queryOne<{ name: string }>('SELECT name FROM projects WHERE id = $1', [effectiveIds[0]]))?.name : undefined;
      const peopleNames = (await queryAll<{ name: string }>('SELECT p.name FROM people p JOIN meeting_people mp ON p.id = mp.person_id WHERE mp.meeting_id = $1', [meetingId])).map(x => x.name);
      const vaultPath = await obsidian.forUser(getUserId(req)).writeMeeting({ title, date, project: projectName, summary: summary_raw, people: peopleNames });
      await execute('UPDATE meetings SET vault_path = $1 WHERE id = $2', [vaultPath, meetingId]);
    } catch {}
  }
  const meeting = await queryOne<Record<string, unknown>>('SELECT * FROM meetings WHERE id = $1', [meetingId]);
  res.status(201).json(ok((await attachProjects([meeting!]))[0]));
});

meetingsRouter.patch('/:id', async (req: AuthRequest, res: Response) => {
  const id = Number(req.params['id']);
  const userId = getUserId(req);
  const existing = await queryOne('SELECT * FROM meetings WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!existing) { res.status(404).json(fail('Meeting not found')); return; }
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { project_ids, person_ids, ...rest } = parsed.data;

  // Handle project_ids separately (junction table)
  if (project_ids !== undefined) {
    await setMeetingProjects(id, project_ids);
  }

  // Handle person_ids separately (junction table)
  if (person_ids !== undefined) {
    await execute('DELETE FROM meeting_people WHERE meeting_id = $1', [id]);
    for (const pid of person_ids) {
      await execute('INSERT INTO meeting_people (meeting_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, pid]);
    }
  }

  const keys = Object.keys(rest).filter(k => (rest as Record<string, unknown>)[k] !== undefined);
  if (keys.length > 0) {
    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const values = keys.map((k) => (rest as Record<string, unknown>)[k] ?? null);
    await execute(`UPDATE meetings SET ${setClauses} WHERE id = $${values.length + 1}`, [...values, id]);
  }

  const updated = await queryOne<Record<string, unknown>>('SELECT * FROM meetings WHERE id = $1', [id]);
  if (updated) searchService.indexRecord('meeting', updated['id'] as number, updated['title'] as string, (updated['summary_raw'] as string) ?? '');

  // Sync to Obsidian vault (async, non-blocking)
  if (updated && (updated['sync_vault'] as number | null | undefined) !== 0) {
    void (async () => {
      try {
        const projectId = updated['project_id'] as number | null;
        const projectName = projectId != null
          ? (await queryOne<{ name: string }>('SELECT name FROM projects WHERE id = $1', [projectId]))?.name
          : undefined;
        const peopleNames = (await queryAll<{ name: string }>('SELECT p.name FROM people p JOIN meeting_people mp ON p.id = mp.person_id WHERE mp.meeting_id = $1', [id])).map(x => x.name);
        const company = (updated['company'] as string | null) ?? undefined;
        const tagsRaw = updated['tags'] as string | null;
        const tags = tagsRaw ? JSON.parse(tagsRaw) as string[] : undefined;
        const source = (updated['source'] as string | null) ?? undefined;
        const agreementsRow = await queryOne<{ c: number }>('SELECT COUNT(*) as c FROM agreements WHERE meeting_id = $1', [id]);
        const agreementsCount = agreementsRow?.c ?? 0;
        let structured: { notes?: string; qa?: string; actions?: string } | undefined;
        try {
          const s = JSON.parse((updated['summary_structured'] as string) || '{}');
          if (s.notes || s.qa || s.actions) structured = { notes: s.notes, qa: s.qa, actions: s.actions };
        } catch {}
        const vaultPath = await obsidian.forUser(userId).writeMeeting({
          title: updated['title'] as string,
          date: updated['date'] as string,
          project: projectName,
          company,
          summary: (updated['summary_raw'] as string) ?? '',
          structured,
          people: peopleNames,
          tags,
          source,
          agreements: agreementsCount,
        });
        const currentPath = updated['vault_path'] as string | null;
        if (vaultPath && vaultPath !== currentPath) {
          await execute('UPDATE meetings SET vault_path = $1 WHERE id = $2', [vaultPath, id]);
        }
      } catch (err) {
        console.error('[meetings.patch] vault sync failed:', err instanceof Error ? err.message : err);
      }
    })();
  } else if (updated && (updated['sync_vault'] as number | null | undefined) === 0) {
    // Sync turned off — delete file from Obsidian vault
    const vaultPath = updated['vault_path'] as string | null;
    if (vaultPath) {
      try { obsidian.forUser(userId).deleteFile(vaultPath); } catch {}
      await execute('UPDATE meetings SET vault_path = NULL WHERE id = $1', [id]);
    }
  }

  res.json(ok((await attachProjects([updated!]))[0]));
});

meetingsRouter.get('/:id', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  const meeting = await queryOne('SELECT * FROM meetings WHERE id = $1 AND user_id = $2', [Number(req.params['id']), userId]);
  if (!meeting) { res.status(404).json(fail('Meeting not found')); return; }
  const agreements = await queryAll('SELECT * FROM agreements WHERE meeting_id = $1', [Number(req.params['id'])]);
  const people = await queryAll('SELECT p.* FROM people p JOIN meeting_people mp ON p.id = mp.person_id WHERE mp.meeting_id = $1', [Number(req.params['id'])]);
  res.json(ok({ ...meeting as object, agreements, people }));
});

meetingsRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  const id = Number(req.params['id']);
  const userId = getUserId(req);
  const meeting = await queryOne<{ vault_path: string | null }>('SELECT vault_path FROM meetings WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!meeting) { res.status(404).json(fail('Meeting not found')); return; }
  await execute('DELETE FROM meeting_people WHERE meeting_id = $1', [id]);
  await execute('DELETE FROM meeting_projects WHERE meeting_id = $1', [id]);
  await execute('DELETE FROM agreements WHERE meeting_id = $1', [id]);
  await execute('DELETE FROM meetings WHERE id = $1', [id]);
  searchService.removeRecord('meeting', id);
  try { if (meeting.vault_path) obsidian.forUser(getUserId(req)).deleteFile(meeting.vault_path); } catch {}
  res.json(ok({ deleted: true }));
});

// Heavy background pipeline: compress → transcribe → summarize → save → sync vault
async function processAudioInBackground(meetingId: number, fileBuffer: Buffer, originalName: string, userId: number | null, autoSummarize: boolean, jobId: number | null = null): Promise<void> {
  const setStatus = async (status: string | null, errMsg?: string | null): Promise<void> => {
    await execute('UPDATE meetings SET processing_status = $1, processing_error = $2 WHERE id = $3', [status, errMsg ?? null, meetingId]);
  };

  try {
    const filename = originalName || 'audio.ogg';
    const origMb = fileBuffer.length / 1024 / 1024;
    const OPENAI_LIMIT_MB = 24;
    const canOpenAI = !!config.openaiApiKey;

    // Step 1: pre-compress to small MP3
    await setStatus('compressing');
    let audioBuffer = fileBuffer;
    let audioName = filename;
    try {
      console.log(`[bg-job ${meetingId}] pre-compressing ${origMb.toFixed(1)}MB ${filename}`);
      const compressed = await compressForTranscription(fileBuffer, filename);
      audioBuffer = compressed;
      audioName = filename.replace(/\.[^.]+$/, '') + '.mp3';
      console.log(`[bg-job ${meetingId}] compressed → ${(compressed.length / 1024 / 1024).toFixed(1)}MB`);
    } catch (err) {
      console.warn(`[bg-job ${meetingId}] compression failed, using original:`, err instanceof Error ? err.message : err);
    }

    // Step 2: transcribe
    await setStatus('transcribing');
    let transcript = '';
    const finalMb = audioBuffer.length / 1024 / 1024;
    const canUseOpenAI = canOpenAI && finalMb <= OPENAI_LIMIT_MB;
    // 152-ФЗ: сырая запись голоса — самые чувствительные персданные, а отправка в
    // OpenAI — трансграничная передача в США. `canUseOpenAI` — это техническая
    // возможность (есть ключ, файл влезает в лимит), `cloudFallbackAllowed` — это
    // разрешение политики. Оба условия нужны, чтобы реально уйти в облако.
    const cloudFallbackAllowed = config.transcriptionAllowCloudFallback;

    /** Платный облачный бэкенд. Держим только как страховку. */
    const viaOpenAI = async (): Promise<string> => {
      // Имя нужно только чтобы whisper-1 угадал формат по расширению. `audioName`
      // тянется из req.file.originalname и слэши в нём сохраняются, поэтому в путь
      // идёт лишь обеззараженное расширение — иначе загрузка с именем вида
      // `../../../etc/cron.d/x` пишет буфер за пределы /tmp.
      const oaExt = path.extname(safeTmpName(audioName)) || '.mp3';
      const tmp = path.join(require('os').tmpdir(), `oa-${Date.now()}-${Math.random().toString(36).slice(2)}${oaExt}`);
      fs.writeFileSync(tmp, audioBuffer);
      try {
        console.log(`[bg-job ${meetingId}] OpenAI whisper-1 for ${finalMb.toFixed(1)}MB`);
        const result = await openai.audio.transcriptions.create({
          model: 'whisper-1',
          file: fs.createReadStream(tmp),
          language: 'ru',
        });
        console.log(`[bg-job ${meetingId}] OpenAI returned ${result.text.length} chars`);
        return result.text;
      } finally {
        try { fs.unlinkSync(tmp); } catch {}
      }
    };

    // Локальная расшифровка идёт первой: она бесплатна и не выпускает запись за
    // пределы сервера. transcribeLocal сам предпочитает микросервис faster-whisper
    // и откатывается на whisper.cpp. Облако — только если локально совсем никак.
    // Раньше порядок был обратный, и веб-загрузка молча уезжала в платный whisper-1,
    // хотя рядом стоял бесплатный локальный бэкенд.
    const localReady = (await isTranscribeServiceAvailable()) || isLocalWhisperAvailable();

    if (localReady) {
      try {
        console.log(`[bg-job ${meetingId}] local transcription for ${finalMb.toFixed(1)}MB`);
        transcript = await transcribeLocal(audioBuffer, audioName);
      } catch (err) {
        console.error(`[bg-job ${meetingId}] local transcription failed:`, err instanceof Error ? err.message : err);
        if (!canUseOpenAI) throw err;
        assertCloudFallbackAllowed(cloudFallbackAllowed, 'Локальная расшифровка не удалась');
        console.log(`[bg-job ${meetingId}] falling back to OpenAI whisper-1`);
        transcript = await viaOpenAI();
      }
    } else if (canUseOpenAI && cloudFallbackAllowed) {
      console.warn(`[bg-job ${meetingId}] no local backend available, using paid OpenAI whisper-1`);
      transcript = await viaOpenAI();
    } else if (canUseOpenAI && !cloudFallbackAllowed) {
      assertCloudFallbackAllowed(cloudFallbackAllowed, 'Локальный бэкенд расшифровки недоступен');
    } else {
      throw new Error('No transcription backend available');
    }

    // Guard: whisper hallucinates looping garbage on unintelligible audio. Save the
    // raw text so nothing is lost, but flag it and skip the AI summary — otherwise
    // Claude confidently "summarizes" pure noise into a plausible-looking meeting.
    const isGarbage = looksLikeGarbage(transcript);
    if (isGarbage) {
      console.warn(`[bg-job ${meetingId}] transcript looks like garbage (${transcript.length} chars) — flagging, skipping summary`);
    }

    // Step 3: save transcript
    const meeting = await queryOne<Record<string, unknown>>('SELECT * FROM meetings WHERE id = $1', [meetingId]);
    if (!meeting) throw new Error('Meeting deleted while processing');
    const existingSummary = (meeting['summary_raw'] as string) || '';
    const transcriptBody = isGarbage
      ? `⚠️ Запись неразборчива — не удалось распознать речь (возможно, тихий звук, шум или искажение). Автоматическое резюме не составлялось.\n\n---\nСырой результат распознавания:\n${transcript}`
      : transcript;
    let mergedBody = existingSummary
      ? `${existingSummary}\n\n---\nТранскрипция (${new Date().toLocaleString('ru')}):\n${transcriptBody}`
      : transcriptBody;
    await execute('UPDATE meetings SET summary_raw = $1, updated_at = NOW() WHERE id = $2', [mergedBody, meetingId]);
    searchService.indexRecord('meeting', meetingId, meeting['title'] as string, mergedBody);

    // Step 4: AI summary
    if (autoSummarize && transcript.trim() && !isGarbage) {
      await setStatus('summarizing');
      try {
        // 152-ФЗ: в модель уходит только обезличенный текст. `piiMap` живёт исключительно
        // в этой переменной — она не пишется в БД, лог или поисковый индекс, и подстановка
        // реальных значений обратно в резюме делается нашим кодом ниже, без участия модели.
        const { text: redactedTranscript, map: piiMap } = redactPii(transcript);
        const rawSummary = (await claude.chat([{ role: 'user', content: redactedTranscript }], SUMMARY_SYS_PROMPT, 'gpt-4.1-mini', false, false)).trim();
        const summary = restorePiiAndWarn(rawSummary, piiMap, `meeting #${meetingId} auto-summary`);
        if (summary && !mergedBody.startsWith('## Ключевые решения')) {
          mergedBody = `${summary}\n\n---\n\n${mergedBody}`;
          await execute('UPDATE meetings SET summary_raw = $1, updated_at = NOW() WHERE id = $2', [mergedBody, meetingId]);
          searchService.indexRecord('meeting', meetingId, meeting['title'] as string, mergedBody);
        }
      } catch (err) {
        console.warn(`[bg-job ${meetingId}] summarize failed:`, err instanceof Error ? err.message : err);
      }
    }

    // Step 5: vault sync
    try {
      const fresh = await queryOne<Record<string, unknown>>('SELECT * FROM meetings WHERE id = $1', [meetingId]);
      const syncOn = (fresh!['sync_vault'] as number | null | undefined) !== 0;
      if (syncOn) {
        const projectName = fresh!['project_id'] ? (await queryOne<{ name: string }>('SELECT name FROM projects WHERE id = $1', [fresh!['project_id'] as number]))?.name : undefined;
        const peopleNames = (await queryAll<{ name: string }>('SELECT p.name FROM people p JOIN meeting_people mp ON p.id = mp.person_id WHERE mp.meeting_id = $1', [meetingId])).map(x => x.name);
        let structured: { notes?: string; qa?: string; actions?: string } | undefined;
        try {
          const s = JSON.parse((fresh!['summary_structured'] as string) || '{}');
          if (s.notes || s.qa || s.actions) structured = { notes: s.notes, qa: s.qa, actions: s.actions };
        } catch {}
        const vp = await obsidian.forUser(userId).writeMeeting({
          title: fresh!['title'] as string,
          date: fresh!['date'] as string,
          project: projectName,
          summary: (fresh!['summary_raw'] as string) ?? '',
          structured,
          people: peopleNames,
        });
        if (vp && vp !== fresh!['vault_path']) {
          await execute('UPDATE meetings SET vault_path = $1 WHERE id = $2', [vp, meetingId]);
        }
      }
    } catch (err) {
      console.warn(`[bg-job ${meetingId}] vault sync failed:`, err instanceof Error ? err.message : err);
    }

    await completeJob(jobId);
    await setStatus('done', null);
    console.log(`[bg-job ${meetingId}] DONE`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[bg-job ${meetingId}] FAILED:`, msg);
    await completeJob(jobId);
    await setStatus('failed', msg);
  }
}

// POST /meetings/:id/transcribe — fires a background job and returns 202 immediately
meetingsRouter.post('/:id/transcribe', upload.single('audio'), async (req: AuthRequest, res: Response) => {
  const id = Number(req.params['id']);
  const meeting = await queryOne<Record<string, unknown>>('SELECT * FROM meetings WHERE id = $1 AND user_id = $2', [id, getUserId(req)]);
  if (!meeting) { res.status(404).json(fail('Meeting not found')); return; }

  if (req.file) {
    const userId = getUserId(req);
    const buffer = req.file.buffer;
    const originalName = req.file.originalname || 'audio.ogg';
    const autoSummarize = req.body?.summarize !== 'false';
    // Mark as queued + kick off background job (don't await)
    await execute('UPDATE meetings SET processing_status = $1, processing_error = NULL WHERE id = $2', ['queued', id]);
    // Аудио на диск ДО старта: перезапуск в первые же секунды иначе снова всё потеряет.
    const jobId = await registerJob({
      kind: 'meeting', buffer, filename: originalName, userId, meetingId: id,
      payload: { autoSummarize },
    });
    void processAudioInBackground(id, buffer, originalName, userId, autoSummarize, jobId);
    res.status(202).json(ok({ id, status: 'queued', message: 'Транскрипция запущена в фоне. Можно закрыть окно.' }));
    return;
  }

  // Sync path: just save text body
  if (req.body?.text) {
    const text = req.body.text as string;
    const existing = (meeting['summary_raw'] as string) || '';
    const merged = existing ? `${existing}\n\n---\n${text}` : text;
    await execute('UPDATE meetings SET summary_raw = $1, updated_at = NOW() WHERE id = $2', [merged, id]);
    searchService.indexRecord('meeting', id, meeting['title'] as string, merged);
    res.json(ok({ id, transcript: text }));
    return;
  }

  res.status(400).json(fail('No audio file or text provided'));
});

// Send meeting summary or full transcription to user's Telegram
type MeetingFileType = 'summary' | 'full' | 'notes' | 'qa' | 'actions';

const SendToTelegramSchema = z.object({
  type: z.enum(['summary', 'full', 'notes', 'qa', 'actions']),
  format: z.enum(['md', 'pdf', 'docx']),
});

const TYPE_LABELS: Record<MeetingFileType, string> = { summary: 'rezume', full: 'polnaya', notes: 'notes', qa: 'qa', actions: 'analysis' };

async function buildMeetingFile(meetingId: number, type: MeetingFileType, format: 'md' | 'pdf' | 'docx'): Promise<{ path: string; filename: string }> {
  const m = await queryOne<{ id: number; title: string; date: string; project_id: number | null; summary_raw: string | null; summary_structured: string | null }>(
    'SELECT id, title, date, project_id, summary_raw, summary_structured FROM meetings WHERE id = $1',
    [meetingId]
  );
  if (!m) throw new Error('Meeting not found');
  const projectName = m.project_id ? (await queryOne<{ name: string }>('SELECT name FROM projects WHERE id = $1', [m.project_id]))?.name : undefined;
  const people = (await queryAll<{ name: string }>('SELECT p.name FROM people p JOIN meeting_people mp ON p.id = mp.person_id WHERE mp.meeting_id = $1', [meetingId])).map((x) => x.name);

  let structured: Record<string, string> = {};
  try { structured = JSON.parse(m.summary_structured || '{}'); } catch {}

  let body: string;
  if (type === 'notes' && structured.notes) {
    body = structured.notes;
  } else if (type === 'qa' && structured.qa) {
    body = structured.qa;
  } else if (type === 'actions' && structured.actions) {
    body = structured.actions;
  } else if (type === 'full') {
    const transcript = structured.transcript || '';
    body = (m.summary_raw ?? '') + (transcript ? `\n\n---\n\n## Полная транскрипция\n\n${transcript}` : '');
  } else {
    // summary or fallback — используется и скачиванием файла, и отправкой в Telegram
    // (sendMeetingToTelegram → buildMeetingFile). 152-ФЗ: транскрипт обезличивается
    // перед отправкой в модель так же, как на пути авто-резюме при загрузке.
    const raw = (m.summary_raw ?? '').trim();
    if (!raw) throw new Error('No content');
    const { text: redactedRaw, map: piiMap } = redactPii(raw);
    const rawBody = await claude.chat([{ role: 'user', content: redactedRaw }], COMPACT_SUMMARY_SYS_PROMPT, 'gpt-4.1-mini', false, false);
    body = restorePiiAndWarn(rawBody, piiMap, `meeting #${meetingId} file export (${type})`);
  }

  const header = [
    `# ${m.title}`,
    '',
    `**Дата:** ${m.date}`,
    projectName ? `**Проект:** ${projectName}` : '',
    people.length ? `**Участники:** ${people.join(', ')}` : '',
    '',
    '---',
    '',
  ].filter((l) => l !== '').join('\n');

  const slug = m.title.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60);
  const baseName = `${m.date}-${slug}-${TYPE_LABELS[type] || type}`;
  const tmpMd = path.join('/tmp', `${baseName}-${Date.now()}.md`);
  fs.writeFileSync(tmpMd, `${header}\n\n${body}\n`, 'utf-8');

  if (format === 'md') return { path: tmpMd, filename: `${baseName}.md` };
  if (format === 'pdf') return { path: mdToPdf(tmpMd), filename: `${baseName}.pdf` };
  return { path: mdToDocx(tmpMd), filename: `${baseName}.docx` };
}

export async function sendMeetingToTelegram(meetingId: number, userId: number, type: MeetingFileType, format: 'md' | 'pdf' | 'docx'): Promise<void> {
  const user = await queryOne<{ tg_id: string | null }>('SELECT tg_id FROM users WHERE id = $1', [userId]);
  if (!user?.tg_id) throw new Error('Telegram не привязан к аккаунту (зайди в Telegram-бот и пришли /start)');
  const { path: filePath, filename } = await buildMeetingFile(meetingId, type, format);
  const caption = type === 'summary' ? '📄 Резюме встречи' : '📄 Полная транскрипция';
  try {
    await telegramService.sendFileToUser(user.tg_id, filePath, filename, caption);
  } finally {
    try { fs.unlinkSync(filePath); } catch {}
    if (filePath.endsWith('.pdf') || filePath.endsWith('.docx')) {
      const mdPath = filePath.replace(/\.(pdf|docx)$/, '.md');
      try { fs.unlinkSync(mdPath); } catch {}
    }
  }
}

// Generate AI summary for a meeting (prepends compact summary to summary_raw body)
meetingsRouter.post('/:id/summarize', async (req: AuthRequest, res: Response) => {
  const id = Number(req.params['id']);
  const userId = getUserId(req);
  const meeting = await queryOne<Record<string, unknown>>('SELECT * FROM meetings WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!meeting) { res.status(404).json(fail('Meeting not found')); return; }
  const raw = ((meeting['summary_raw'] as string) ?? '').trim();
  if (!raw) { res.status(400).json(fail('No content to summarize')); return; }

  try {
    // 152-ФЗ: тот же путь резюмирования, что и авто-резюме при загрузке — просто
    // запущен пользователем вручную кнопкой «Сделать резюме». Транскрипт
    // обезличивается перед отправкой в модель, реальные значения подставляются
    // обратно нашим кодом до сохранения в БД и поисковый индекс.
    const { text: redactedRaw, map: piiMap } = redactPii(raw);
    const rawSummary = (await claude.chat([{ role: 'user', content: redactedRaw }], SUMMARY_SYS_PROMPT, 'gpt-4.1-mini', false, false)).trim();
    const summary = restorePiiAndWarn(rawSummary, piiMap, `meeting #${id} manual summarize`);
    const separator = '\n\n---\n\n';
    const marker = '## Ключевые решения';
    const existingStart = raw.indexOf(marker);
    const newSummary = existingStart === 0
      ? raw // already starts with a summary — skip (caller can regenerate by clearing first)
      : `${summary}${separator}${raw}`;
    await execute('UPDATE meetings SET summary_raw = $1, updated_at = NOW() WHERE id = $2', [newSummary, id]);
    searchService.indexRecord('meeting', id, meeting['title'] as string, newSummary);
    res.json(ok({ summary, summary_raw: newSummary }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Summarize error'));
  }
});

// Regenerate pro summaries (Notes + Q&A) with meeting type
meetingsRouter.post('/:id/regenerate-summaries', async (req: AuthRequest, res: Response) => {
  const id = Number(req.params['id']);
  const userId = getUserId(req);
  const meeting = await queryOne<Record<string, unknown>>('SELECT * FROM meetings WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!meeting) { res.status(404).json(fail('Meeting not found')); return; }

  // Get transcript from summary_structured
  let transcript = '';
  try {
    const s = JSON.parse((meeting['summary_structured'] as string) || '{}');
    transcript = s.transcript || '';
  } catch {}
  if (!transcript) transcript = (meeting['summary_raw'] as string) || '';
  if (!transcript || transcript.length < 50) { res.status(400).json(fail('No transcript to summarize')); return; }

  const meetingType = (req.body?.meeting_type as string) || (meeting['meeting_type'] as string) || 'meeting';

  // Update meeting_type in DB
  if (meetingType !== meeting['meeting_type']) {
    await execute('UPDATE meetings SET meeting_type = $1 WHERE id = $2', [meetingType, id]);
  }

  // Get people
  const peopleRows = await queryAll<{ name: string }>('SELECT p.name FROM people p JOIN meeting_people mp ON p.id = mp.person_id WHERE mp.meeting_id = $1', [id]);
  const people = peopleRows.map(p => p.name);

  // 152-ФЗ: этот путь шлёт в модель не только транскрипт, но и заголовок встречи, и
  // `people` — реальные имена контактов из таблицы `people`, а не то, что модель сама
  // распознала в речи (найдено ревью: заголовок вида «Созвон с Иваном Петровым» раньше
  // уходил в модель как есть, рядом с уже обезличенным транскриптом — реальное имя в
  // заголовке ещё и подсказывало модели, как расшифровать токены в теле). Обезличиваем
  // все три поля ОДНИМ вызовом redactPii через joinForRedaction/splitRedacted, чтобы
  // одно и то же имя в транскрипте, заголовке и списке участников получило один и тот
  // же токен; восстанавливаем во всех трёх документах, которые вернёт generateProSummaries
  // (notes/qa/actions) — сам заголовок в БД не переписывается, он используется только
  // как контекст для модели.
  const title = (meeting['title'] as string) ?? '';
  const { text: redactedCombined, map: piiMap } = redactPii(joinForRedaction([transcript, title, people.join('\n')]));
  const redactedParts = splitRedacted(redactedCombined, 3);
  const redactedTranscript = redactedParts[0] ?? '';
  const redactedTitle = redactedParts[1] ?? '';
  const redactedPeopleBlock = redactedParts[2] ?? '';
  const redactedPeople = redactedPeopleBlock ? redactedPeopleBlock.split('\n') : [];

  res.json(ok({ status: 'generating', meeting_type: meetingType }));

  // Async generation
  const { ClaudeService } = require('../services/claude.service');
  const claudeSvc = new ClaudeService();
  claudeSvc.generateProSummaries(redactedTranscript, redactedTitle, redactedPeople, meetingType).then(async (rawSummaries: { notes: string; qa: string; actions?: string }) => {
    const summaries = {
      notes: restorePiiAndWarn(rawSummaries.notes, piiMap, `meeting #${id} pro-summary notes`),
      qa: restorePiiAndWarn(rawSummaries.qa, piiMap, `meeting #${id} pro-summary qa`),
      ...(rawSummaries.actions ? { actions: restorePiiAndWarn(rawSummaries.actions, piiMap, `meeting #${id} pro-summary actions`) } : {}),
    };
    const existingRow = await queryOne<{ summary_structured: string | null }>('SELECT summary_structured FROM meetings WHERE id = $1', [id]);
    let merged: Record<string, unknown> = {};
    try { merged = JSON.parse(existingRow?.summary_structured || '{}'); } catch {}
    merged = { ...merged, ...summaries };
    await execute(
      'UPDATE meetings SET summary_raw = $1, summary_structured = $2, updated_at = NOW() WHERE id = $3',
      [summaries.notes || meeting['summary_raw'], JSON.stringify(merged), id]
    );
    console.log(`[regenerate] pro summaries generated for meeting #${id} (type=${meetingType})`);
  }).catch((err: Error) => {
    console.error(`[regenerate] failed for meeting #${id}:`, err.message);
  });
});

// Download meeting file (summary or full) as md/pdf/docx
// POST /meetings/:id/download-token — short-lived (10 min) token scoped to THIS
// meeting's download. Keeps the full 30-day session JWT out of shareable URLs.
meetingsRouter.post('/:id/download-token', async (req: AuthRequest, res: Response) => {
  const id = Number(req.params['id']);
  const userId = getUserId(req);
  if (userId == null) { res.status(401).json(fail('Not authenticated')); return; }
  const owns = await queryOne('SELECT id FROM meetings WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!owns) { res.status(404).json(fail('Meeting not found')); return; }
  const token = jwt.sign({ id: userId, purpose: 'download', meeting_id: id }, config.jwtSecret, { expiresIn: '10m' });
  res.json(ok({ token }));
});

// Exported + mounted PUBLICLY (before requireAuth) in routes/index.ts, because a
// browser navigation can't send an Authorization header — the scoped ?token= is
// the auth. The handler verifies a session OR a download-scoped token itself.
export async function downloadMeetingHandler(req: AuthRequest, res: Response): Promise<void> {
  const id = Number(req.params['id']);
  // Auth: a real session ONLY via the Authorization header. Via the URL (no
  // header — a browser navigation) accept ONLY a scoped download token, never a
  // full session JWT in ?token=. This keeps session tokens out of shareable URLs.
  let userId: number | null = null;
  if (req.headers['authorization']) {
    userId = getUserId(req);
  } else {
    try {
      const p = jwt.verify(String(req.query['token'] || ''), config.jwtSecret) as { id?: number; purpose?: string; meeting_id?: number };
      if (p.purpose === 'download' && p.meeting_id === id && typeof p.id === 'number') userId = p.id;
    } catch { /* invalid/expired/non-download token */ }
  }
  if (userId == null) { res.status(401).json(fail('Not authenticated')); return; }
  const exists = await queryOne('SELECT id FROM meetings WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!exists) { res.status(404).json(fail('Meeting not found')); return; }
  const validTypes: MeetingFileType[] = ['summary', 'full', 'notes', 'qa', 'actions'];
  const type = (validTypes.includes(req.query['type'] as MeetingFileType) ? req.query['type'] : 'summary') as MeetingFileType;
  const format = (['md', 'pdf', 'docx'].includes(req.query['format'] as string) ? req.query['format'] : 'md') as 'md' | 'pdf' | 'docx';
  try {
    const { path: filePath, filename } = await buildMeetingFile(id, type, format);
    res.download(filePath, filename, () => {
      try { fs.unlinkSync(filePath); } catch {}
      if (filePath.endsWith('.pdf') || filePath.endsWith('.docx')) {
        const mdPath = filePath.replace(/\.(pdf|docx)$/, '.md');
        try { fs.unlinkSync(mdPath); } catch {}
      }
    });
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Download failed'));
  }
}

meetingsRouter.post('/:id/send-to-telegram', async (req: AuthRequest, res: Response) => {
  const parsed = SendToTelegramSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const id = Number(req.params['id']);
  const userId = getUserId(req);
  if (userId == null) { res.status(401).json(fail('Not authenticated')); return; }
  const exists = await queryOne('SELECT id FROM meetings WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!exists) { res.status(404).json(fail('Meeting not found')); return; }
  try {
    await sendMeetingToTelegram(id, userId, parsed.data.type, parsed.data.format);
    res.json(ok({ sent: true, format: parsed.data.format, type: parsed.data.type }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Send failed'));
  }
});

/**
 * Возобновление расшифровок, прерванных перезапуском API.
 * Вызывается один раз при старте (см. index.ts).
 */
export async function resumeInterruptedTranscriptions(): Promise<void> {
  await resumePendingJobs({
    meeting: async (job: PendingJob, buffer: Buffer) => {
      if (job.meeting_id == null) throw new Error('в задаче нет meeting_id');
      let autoSummarize = true;
      try { autoSummarize = JSON.parse(job.payload || '{}').autoSummarize !== false; } catch {}
      await execute('UPDATE meetings SET processing_status = $1, processing_error = NULL WHERE id = $2', ['queued', job.meeting_id]);
      await processAudioInBackground(job.meeting_id, buffer, job.filename, job.user_id, autoSummarize, job.id);
    },

    telegramAudio: async (job: PendingJob, buffer: Buffer) => {
      await telegramService.resumeInterruptedAudio(job.tg_id, buffer, job.filename, job.id);
    },

    giveUp: async (job: PendingJob, reason: string) => {
      const text = `Расшифровка не была доведена до конца: сервер перезапустился, ${reason}. Пришлите запись ещё раз.`;
      if (job.meeting_id != null) {
        await execute('UPDATE meetings SET processing_status = $1, processing_error = $2 WHERE id = $3', ['failed', text, job.meeting_id]);
      }
      if (job.tg_id) {
        try { await telegramService.notifyUser(job.tg_id, `⚠️ ${text}`); } catch {}
      }
    },
  });
}
