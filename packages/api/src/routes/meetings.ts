import { Router, Request, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';
import { searchService } from '../services/search.service';
import { ObsidianService } from '../services/obsidian.service';
import { config } from '../config';
import OpenAI from 'openai';
import type { AuthRequest } from '../middleware/auth';
import { getUserId, userScopeWhere } from '../middleware/user-scope';

const obsidian = new ObsidianService(config.vaultPath);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const openai = new OpenAI({ apiKey: config.openaiApiKey });

export const meetingsRouter = Router();

const CreateSchema = z.object({
  title: z.string().min(1),
  date: z.string(),
  project_id: z.number().int().optional(),
  project_ids: z.array(z.number().int()).optional(),
  summary_raw: z.string().default(''),
});
const UpdateSchema = z.object({
  title: z.string().min(1).optional(),
  date: z.string().optional(),
  project_id: z.number().int().nullable().optional(),
  project_ids: z.array(z.number().int()).optional(),
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
  const { title, date, project_id, project_ids, summary_raw } = parsed.data;
  const effectiveIds = project_ids && project_ids.length > 0 ? project_ids : project_id != null ? [project_id] : [];
  const userId = getUserId(req);
  const result = getDb().prepare('INSERT INTO meetings (title, date, project_id, summary_raw, user_id) VALUES (?, ?, ?, ?, ?)').run(title, date, effectiveIds[0] ?? null, summary_raw, userId);
  const meetingId = Number(result.lastInsertRowid);
  if (effectiveIds.length > 0) setMeetingProjects(meetingId, effectiveIds);
  searchService.indexRecord('meeting', meetingId, title, summary_raw);
  // Sync to vault
  try {
    const projectName = effectiveIds[0] ? (getDb().prepare('SELECT name FROM projects WHERE id = ?').get(effectiveIds[0]) as { name: string } | undefined)?.name : undefined;
    const vaultPath = await obsidian.forUser(getUserId(req)).writeMeeting({ title, date, project: projectName, summary: summary_raw, people: [] });
    getDb().prepare('UPDATE meetings SET vault_path = ? WHERE id = ?').run(vaultPath, meetingId);
  } catch {}
  const meeting = getDb().prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId) as Record<string, unknown>;
  res.status(201).json(ok(attachProjects([meeting])[0]));
});

meetingsRouter.patch('/:id', (req: AuthRequest, res: Response) => {
  const id = Number(req.params['id']);
  const existing = getDb().prepare('SELECT * FROM meetings WHERE id = ?').get(id);
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
  res.json(ok(attachProjects([updated])[0]));
});

meetingsRouter.get('/:id', (req: AuthRequest, res: Response) => {
  const meeting = getDb().prepare('SELECT * FROM meetings WHERE id = ?').get(Number(req.params['id']));
  if (!meeting) { res.status(404).json(fail('Meeting not found')); return; }
  const agreements = getDb().prepare('SELECT * FROM agreements WHERE meeting_id = ?').all(Number(req.params['id']));
  const people = getDb().prepare('SELECT p.* FROM people p JOIN meeting_people mp ON p.id = mp.person_id WHERE mp.meeting_id = ?').all(Number(req.params['id']));
  res.json(ok({ ...meeting as object, agreements, people }));
});

meetingsRouter.delete('/:id', (req: AuthRequest, res: Response) => {
  const id = Number(req.params['id']);
  const meeting = getDb().prepare('SELECT vault_path FROM meetings WHERE id = ?').get(id) as { vault_path: string | null } | undefined;
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
      // Transcribe audio via Whisper
      const file = new File([req.file.buffer], req.file.originalname || 'audio.ogg', { type: req.file.mimetype });
      const result = await openai.audio.transcriptions.create({
        model: 'whisper-1',
        file,
        language: 'ru',
      });
      transcript = result.text;
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

    // Update vault file
    try {
      const vp = meeting['vault_path'] as string | null;
      if (vp) {
        const projectName = meeting['project_id'] ? (getDb().prepare('SELECT name FROM projects WHERE id = ?').get(meeting['project_id'] as number) as { name: string } | undefined)?.name : undefined;
        await obsidian.forUser(getUserId(req)).writeMeeting({
          title: meeting['title'] as string,
          date: meeting['date'] as string,
          project: projectName,
          summary: newSummary,
          people: [],
        });
      }
    } catch {}

    const updated = getDb().prepare('SELECT * FROM meetings WHERE id = ?').get(id);
    res.json(ok({ ...updated as object, transcript }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Transcription error'));
  }
});
