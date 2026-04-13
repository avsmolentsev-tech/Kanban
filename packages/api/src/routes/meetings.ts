import { Router, Request, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';
import { searchService } from '../services/search.service';
import { ObsidianService } from '../services/obsidian.service';
import { ClaudeService } from '../services/claude.service';
import { mdToPdf, mdToDocx } from '../services/converter.service';
import { telegramService } from '../services/telegram.service';
import { isLocalWhisperAvailable, transcribeLocal, compressForTranscription } from '../services/whisper-local.service';
import { config } from '../config';
import OpenAI from 'openai';
import type { AuthRequest } from '../middleware/auth';
import { getUserId, userScopeWhere } from '../middleware/user-scope';

const obsidian = new ObsidianService(config.vaultPath);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const openai = new OpenAI({ apiKey: config.openaiApiKey });
const claude = new ClaudeService();

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
  sync_vault: z.boolean().optional(),
  summary_raw: z.string().optional(),
});

function attachProjects(meetings: Record<string, unknown>[]): Record<string, unknown>[] {
  if (meetings.length === 0) return meetings;
  const ids = meetings.map(m => m['id']);
  const rows = getDb().prepare(`
    SELECT mp.meeting_id, p.id, p.name, p.color
    FROM meeting_projects mp JOIN projects p ON p.id = mp.project_id
    WHERE mp.meeting_id IN (${ids.map(() => '?').join(',')})
  `).all(...ids) as Array<{ meeting_id: number; id: number; name: string; color: string }>;
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

function setMeetingProjects(meetingId: number, projectIds: number[]): void {
  const db = getDb();
  db.prepare('DELETE FROM meeting_projects WHERE meeting_id = ?').run(meetingId);
  const stmt = db.prepare('INSERT OR IGNORE INTO meeting_projects (meeting_id, project_id) VALUES (?, ?)');
  for (const pid of projectIds) stmt.run(meetingId, pid);
  // Keep legacy project_id in sync with first
  db.prepare('UPDATE meetings SET project_id = ? WHERE id = ?').run(projectIds[0] ?? null, meetingId);
}

meetingsRouter.get('/', (req: AuthRequest, res: Response) => {
  const scope = userScopeWhere(req);
  let query = 'SELECT DISTINCT m.* FROM meetings m';
  const params: unknown[] = [];
  if (req.query['project']) {
    query += ' LEFT JOIN meeting_projects mp ON mp.meeting_id = m.id WHERE (m.project_id = ? OR mp.project_id = ?)';
    params.push(Number(req.query['project']), Number(req.query['project']));
    query += ` AND ${scope.sql}`;
    params.push(...scope.params);
  } else {
    query += ` WHERE ${scope.sql}`;
    params.push(...scope.params);
  }
  if (req.query['from']) { query += ' AND m.date >= ?'; params.push(req.query['from']); }
  if (req.query['to']) { query += ' AND m.date <= ?'; params.push(req.query['to']); }
  query += ' ORDER BY m.date DESC';
  const meetings = getDb().prepare(query).all(...params) as Record<string, unknown>[];
  res.json(ok(attachProjects(meetings)));
});

meetingsRouter.post('/', async (req: AuthRequest, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { title, date, project_id, project_ids, summary_raw, sync_vault } = parsed.data;
  const effectiveIds = project_ids && project_ids.length > 0 ? project_ids : project_id != null ? [project_id] : [];
  const shouldSync = sync_vault !== false;
  const userId = getUserId(req);
  const result = getDb().prepare('INSERT INTO meetings (title, date, project_id, summary_raw, user_id, sync_vault) VALUES (?, ?, ?, ?, ?, ?)').run(title, date, effectiveIds[0] ?? null, summary_raw, userId, shouldSync ? 1 : 0);
  const meetingId = Number(result.lastInsertRowid);
  if (effectiveIds.length > 0) setMeetingProjects(meetingId, effectiveIds);
  searchService.indexRecord('meeting', meetingId, title, summary_raw);
  // Sync to vault (only if enabled)
  if (shouldSync) {
    try {
      const projectName = effectiveIds[0] ? (getDb().prepare('SELECT name FROM projects WHERE id = ?').get(effectiveIds[0]) as { name: string } | undefined)?.name : undefined;
      const peopleNames = (getDb().prepare('SELECT p.name FROM people p JOIN meeting_people mp ON p.id = mp.person_id WHERE mp.meeting_id = ?').all(meetingId) as Array<{ name: string }>).map(x => x.name);
      const vaultPath = await obsidian.forUser(getUserId(req)).writeMeeting({ title, date, project: projectName, summary: summary_raw, people: peopleNames });
      getDb().prepare('UPDATE meetings SET vault_path = ? WHERE id = ?').run(vaultPath, meetingId);
    } catch {}
  }
  const meeting = getDb().prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId) as Record<string, unknown>;
  res.status(201).json(ok(attachProjects([meeting])[0]));
});

meetingsRouter.patch('/:id', (req: AuthRequest, res: Response) => {
  const id = Number(req.params['id']);
  const userId = getUserId(req);
  const existing = getDb().prepare('SELECT * FROM meetings WHERE id = ? AND (user_id = ? OR user_id IS NULL)').get(id, userId);
  if (!existing) { res.status(404).json(fail('Meeting not found')); return; }
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { project_ids, ...rest } = parsed.data;

  // Handle project_ids separately (junction table)
  if (project_ids !== undefined) {
    setMeetingProjects(id, project_ids);
  }

  const keys = Object.keys(rest).filter(k => (rest as Record<string, unknown>)[k] !== undefined);
  if (keys.length > 0) {
    const setClauses = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => (rest as Record<string, unknown>)[k] ?? null);
    getDb().prepare(`UPDATE meetings SET ${setClauses} WHERE id = ?`).run(...values, id);
  }

  const updated = getDb().prepare('SELECT * FROM meetings WHERE id = ?').get(id) as Record<string, unknown>;
  if (updated) searchService.indexRecord('meeting', updated['id'] as number, updated['title'] as string, (updated['summary_raw'] as string) ?? '');

  // Sync to Obsidian vault (async, non-blocking) — only if sync_vault flag is on
  if (updated && (updated['sync_vault'] as number | null | undefined) !== 0) {
    void (async () => {
      try {
        const projectId = updated['project_id'] as number | null;
        const projectName = projectId != null
          ? (getDb().prepare('SELECT name FROM projects WHERE id = ?').get(projectId) as { name: string } | undefined)?.name
          : undefined;
        const peopleNames = (getDb().prepare('SELECT p.name FROM people p JOIN meeting_people mp ON p.id = mp.person_id WHERE mp.meeting_id = ?').all(id) as Array<{ name: string }>).map(x => x.name);
        const vaultPath = await obsidian.forUser(userId).writeMeeting({
          title: updated['title'] as string,
          date: updated['date'] as string,
          project: projectName,
          summary: (updated['summary_raw'] as string) ?? '',
          people: peopleNames,
        });
        const currentPath = updated['vault_path'] as string | null;
        if (vaultPath && vaultPath !== currentPath) {
          getDb().prepare('UPDATE meetings SET vault_path = ? WHERE id = ?').run(vaultPath, id);
        }
      } catch (err) {
        console.error('[meetings.patch] vault sync failed:', err instanceof Error ? err.message : err);
      }
    })();
  }

  res.json(ok(attachProjects([updated])[0]));
});

meetingsRouter.get('/:id', (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  const meeting = getDb().prepare('SELECT * FROM meetings WHERE id = ? AND (user_id = ? OR user_id IS NULL)').get(Number(req.params['id']), userId);
  if (!meeting) { res.status(404).json(fail('Meeting not found')); return; }
  const agreements = getDb().prepare('SELECT * FROM agreements WHERE meeting_id = ?').all(Number(req.params['id']));
  const people = getDb().prepare('SELECT p.* FROM people p JOIN meeting_people mp ON p.id = mp.person_id WHERE mp.meeting_id = ?').all(Number(req.params['id']));
  res.json(ok({ ...meeting as object, agreements, people }));
});

meetingsRouter.delete('/:id', (req: AuthRequest, res: Response) => {
  const id = Number(req.params['id']);
  const userId = getUserId(req);
  const meeting = getDb().prepare('SELECT vault_path FROM meetings WHERE id = ? AND (user_id = ? OR user_id IS NULL)').get(id, userId) as { vault_path: string | null } | undefined;
  if (!meeting) { res.status(404).json(fail('Meeting not found')); return; }
  getDb().prepare('DELETE FROM meeting_people WHERE meeting_id = ?').run(id);
  getDb().prepare('DELETE FROM meeting_projects WHERE meeting_id = ?').run(id);
  getDb().prepare('DELETE FROM agreements WHERE meeting_id = ?').run(id);
  getDb().prepare('DELETE FROM meetings WHERE id = ?').run(id);
  searchService.removeRecord('meeting', id);
  try { if (meeting.vault_path) obsidian.forUser(getUserId(req)).deleteFile(meeting.vault_path); } catch {}
  res.json(ok({ deleted: true }));
});

// Transcribe audio file and attach to meeting
meetingsRouter.post('/:id/transcribe', upload.single('audio'), async (req: AuthRequest, res: Response) => {
  const id = Number(req.params['id']);
  const meeting = getDb().prepare('SELECT * FROM meetings WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!meeting) { res.status(404).json(fail('Meeting not found')); return; }

  try {
    let transcript = '';

    if (req.file) {
      const filename = req.file.originalname || 'audio.ogg';
      const origMb = req.file.buffer.length / 1024 / 1024;
      const OPENAI_LIMIT_MB = 24;
      const canOpenAI = !!config.openaiApiKey;

      // Step 1: always pre-compress to small MP3 (16kHz mono 32kbps, ~15MB per hour of voice).
      // Works for ogg/mp3/mp4/m4a/webm/wav/flac/mov — anything ffmpeg can read.
      let audioBuffer = req.file.buffer;
      let audioName = filename;
      try {
        console.log(`[transcribe] pre-compressing ${origMb.toFixed(1)}MB ${filename}`);
        const compressed = await compressForTranscription(req.file.buffer, filename);
        const compMb = compressed.length / 1024 / 1024;
        console.log(`[transcribe] compressed to ${compMb.toFixed(1)}MB MP3 (${(origMb > 0 ? (1 - compMb / origMb) * 100 : 0).toFixed(0)}% smaller)`);
        audioBuffer = compressed;
        audioName = filename.replace(/\.[^.]+$/, '') + '.mp3';
      } catch (err) {
        console.warn('[transcribe] compression failed, using original:', err instanceof Error ? err.message : err);
      }

      const finalMb = audioBuffer.length / 1024 / 1024;
      const useOpenAI = canOpenAI && finalMb <= OPENAI_LIMIT_MB;

      if (useOpenAI) {
        try {
          console.log(`[transcribe] OpenAI whisper-1 for ${finalMb.toFixed(1)}MB`);
          const file = new File([audioBuffer], audioName, { type: 'audio/mpeg' });
          const result = await openai.audio.transcriptions.create({ model: 'whisper-1', file, language: 'ru' });
          transcript = result.text;
        } catch (err) {
          console.warn('[transcribe] OpenAI failed, fallback to local:', err instanceof Error ? err.message : err);
          if (isLocalWhisperAvailable()) {
            transcript = await transcribeLocal(audioBuffer, audioName);
          } else {
            throw err;
          }
        }
      } else if (isLocalWhisperAvailable()) {
        console.log(`[transcribe] local whisper.cpp for ${finalMb.toFixed(1)}MB (OpenAI limit exceeded)`);
        transcript = await transcribeLocal(audioBuffer, audioName);
      } else {
        throw new Error('No transcription backend available');
      }
    } else if (req.body.text) {
      transcript = req.body.text;
    } else {
      res.status(400).json(fail('No audio file or text provided'));
      return;
    }

    // Append transcript to summary
    const existingSummary = (meeting['summary_raw'] as string) || '';
    const newSummary = existingSummary
      ? `${existingSummary}\n\n---\nТранскрипция (${new Date().toLocaleString('ru')}):\n${transcript}`
      : transcript;

    getDb().prepare("UPDATE meetings SET summary_raw = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").run(newSummary, id);
    searchService.indexRecord('meeting', id, meeting['title'] as string, newSummary);

    // Update vault file (only if sync enabled for this meeting)
    try {
      const vp = meeting['vault_path'] as string | null;
      const syncOn = (meeting['sync_vault'] as number | null | undefined) !== 0;
      if (vp && syncOn) {
        const projectName = meeting['project_id'] ? (getDb().prepare('SELECT name FROM projects WHERE id = ?').get(meeting['project_id'] as number) as { name: string } | undefined)?.name : undefined;
        const peopleNames = (getDb().prepare('SELECT p.name FROM people p JOIN meeting_people mp ON p.id = mp.person_id WHERE mp.meeting_id = ?').all(id) as Array<{ name: string }>).map(x => x.name);
        await obsidian.forUser(getUserId(req)).writeMeeting({
          title: meeting['title'] as string,
          date: meeting['date'] as string,
          project: projectName,
          summary: newSummary,
          people: peopleNames,
        });
      }
    } catch {}

    const updated = getDb().prepare('SELECT * FROM meetings WHERE id = ?').get(id);
    res.json(ok({ ...updated as object, transcript }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Transcription error'));
  }
});

// Send meeting summary or full transcription to user's Telegram
const SendToTelegramSchema = z.object({
  type: z.enum(['summary', 'full']),
  format: z.enum(['md', 'pdf', 'docx']),
});

async function buildMeetingFile(meetingId: number, type: 'summary' | 'full', format: 'md' | 'pdf' | 'docx'): Promise<{ path: string; filename: string }> {
  const db = getDb();
  const m = db.prepare('SELECT id, title, date, project_id, summary_raw FROM meetings WHERE id = ?').get(meetingId) as { id: number; title: string; date: string; project_id: number | null; summary_raw: string | null } | undefined;
  if (!m) throw new Error('Meeting not found');
  const projectName = m.project_id ? (db.prepare('SELECT name FROM projects WHERE id = ?').get(m.project_id) as { name: string } | undefined)?.name : undefined;
  const people = (db.prepare('SELECT p.name FROM people p JOIN meeting_people mp ON p.id = mp.person_id WHERE mp.meeting_id = ?').all(meetingId) as Array<{ name: string }>).map((x) => x.name);

  let body: string;
  if (type === 'summary') {
    const raw = (m.summary_raw ?? '').trim();
    if (!raw) throw new Error('No content to summarize');
    const sys = 'Ты редактор. Сделай компактное структурированное резюме встречи в markdown: цели, ключевые решения, договорённости, задачи, следующие шаги. 200-500 слов, без воды.';
    const summary = await claude.chat([{ role: 'user', content: raw }], sys, 'gpt-4.1-mini', false, false);
    body = summary.trim();
  } else {
    body = m.summary_raw ?? '(пусто)';
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
  const baseName = `${m.date}-${slug}-${type === 'summary' ? 'rezume' : 'polnaya'}`;
  const tmpMd = path.join('/tmp', `${baseName}-${Date.now()}.md`);
  fs.writeFileSync(tmpMd, `${header}\n\n${body}\n`, 'utf-8');

  if (format === 'md') return { path: tmpMd, filename: `${baseName}.md` };
  if (format === 'pdf') return { path: mdToPdf(tmpMd), filename: `${baseName}.pdf` };
  return { path: mdToDocx(tmpMd), filename: `${baseName}.docx` };
}

export async function sendMeetingToTelegram(meetingId: number, userId: number, type: 'summary' | 'full', format: 'md' | 'pdf' | 'docx'): Promise<void> {
  const db = getDb();
  const user = db.prepare('SELECT tg_id FROM users WHERE id = ?').get(userId) as { tg_id: string | null } | undefined;
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
  const meeting = getDb().prepare('SELECT * FROM meetings WHERE id = ? AND (user_id = ? OR user_id IS NULL)').get(id, userId) as Record<string, unknown> | undefined;
  if (!meeting) { res.status(404).json(fail('Meeting not found')); return; }
  const raw = ((meeting['summary_raw'] as string) ?? '').trim();
  if (!raw) { res.status(400).json(fail('No content to summarize')); return; }

  try {
    const sys = 'Ты редактор. Сделай структурированное резюме встречи в markdown: ## Ключевые решения, ## Договорённости, ## Задачи, ## Следующие шаги. 200-500 слов, по делу, без воды.';
    const summary = (await claude.chat([{ role: 'user', content: raw }], sys, 'gpt-4.1-mini', false, false)).trim();
    const separator = '\n\n---\n\n';
    const marker = '## Ключевые решения';
    const existingStart = raw.indexOf(marker);
    const newSummary = existingStart === 0
      ? raw // already starts with a summary — skip (caller can regenerate by clearing first)
      : `${summary}${separator}${raw}`;
    getDb().prepare("UPDATE meetings SET summary_raw = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").run(newSummary, id);
    searchService.indexRecord('meeting', id, meeting['title'] as string, newSummary);
    res.json(ok({ summary, summary_raw: newSummary }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Summarize error'));
  }
});

meetingsRouter.post('/:id/send-to-telegram', async (req: AuthRequest, res: Response) => {
  const parsed = SendToTelegramSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const id = Number(req.params['id']);
  const userId = getUserId(req);
  if (userId == null) { res.status(401).json(fail('Not authenticated')); return; }
  const exists = getDb().prepare('SELECT id FROM meetings WHERE id = ? AND (user_id = ? OR user_id IS NULL)').get(id, userId);
  if (!exists) { res.status(404).json(fail('Meeting not found')); return; }
  try {
    await sendMeetingToTelegram(id, userId, parsed.data.type, parsed.data.format);
    res.json(ok({ sent: true, format: parsed.data.format, type: parsed.data.type }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Send failed'));
  }
});
