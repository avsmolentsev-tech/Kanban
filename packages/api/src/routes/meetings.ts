import { Router, Request, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';
import { searchService } from '../services/search.service';
import { ObsidianService } from '../services/obsidian.service';
import { config } from '../config';
import OpenAI from 'openai';

const obsidian = new ObsidianService(config.vaultPath);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const openai = new OpenAI({ apiKey: config.openaiApiKey });

export const meetingsRouter = Router();

const CreateSchema = z.object({ title: z.string().min(1), date: z.string(), project_id: z.number().int().optional(), summary_raw: z.string().default('') });
const UpdateSchema = z.object({ title: z.string().min(1).optional(), date: z.string().optional(), project_id: z.number().int().nullable().optional(), summary_raw: z.string().optional() });

meetingsRouter.get('/', (req: Request, res: Response) => {
  let query = 'SELECT * FROM meetings WHERE 1=1';
  const params: unknown[] = [];
  if (req.query['project']) { query += ' AND project_id = ?'; params.push(Number(req.query['project'])); }
  if (req.query['from']) { query += ' AND date >= ?'; params.push(req.query['from']); }
  if (req.query['to']) { query += ' AND date <= ?'; params.push(req.query['to']); }
  query += ' ORDER BY date DESC';
  res.json(ok(getDb().prepare(query).all(...params)));
});

meetingsRouter.post('/', async (req: Request, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { title, date, project_id, summary_raw } = parsed.data;
  const result = getDb().prepare('INSERT INTO meetings (title, date, project_id, summary_raw) VALUES (?, ?, ?, ?)').run(title, date, project_id ?? null, summary_raw);
  const meetingId = Number(result.lastInsertRowid);
  searchService.indexRecord('meeting', meetingId, title, summary_raw);
  // Sync to vault
  try {
    const projectName = project_id ? (getDb().prepare('SELECT name FROM projects WHERE id = ?').get(project_id) as { name: string } | undefined)?.name : undefined;
    const vaultPath = await obsidian.writeMeeting({ title, date, project: projectName, summary: summary_raw, people: [] });
    getDb().prepare('UPDATE meetings SET vault_path = ? WHERE id = ?').run(vaultPath, meetingId);
  } catch {}
  res.status(201).json(ok(getDb().prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId)));
});

meetingsRouter.patch('/:id', (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  const existing = getDb().prepare('SELECT * FROM meetings WHERE id = ?').get(id);
  if (!existing) { res.status(404).json(fail('Meeting not found')); return; }
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const fields = parsed.data;
  const keys = Object.keys(fields) as Array<keyof typeof fields>;
  if (keys.length === 0) { res.json(ok(existing)); return; }
  const setClauses = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => fields[k] ?? null);
  getDb().prepare(`UPDATE meetings SET ${setClauses} WHERE id = ?`).run(...values, id);
  const updated = getDb().prepare('SELECT * FROM meetings WHERE id = ?').get(id) as any;
  if (updated) searchService.indexRecord('meeting', updated.id, updated.title, updated.summary_raw ?? '');
  res.json(ok(updated));
});

meetingsRouter.get('/:id', (req: Request, res: Response) => {
  const meeting = getDb().prepare('SELECT * FROM meetings WHERE id = ?').get(Number(req.params['id']));
  if (!meeting) { res.status(404).json(fail('Meeting not found')); return; }
  const agreements = getDb().prepare('SELECT * FROM agreements WHERE meeting_id = ?').all(Number(req.params['id']));
  const people = getDb().prepare('SELECT p.* FROM people p JOIN meeting_people mp ON p.id = mp.person_id WHERE mp.meeting_id = ?').all(Number(req.params['id']));
  res.json(ok({ ...meeting as object, agreements, people }));
});

meetingsRouter.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  const meeting = getDb().prepare('SELECT vault_path FROM meetings WHERE id = ?').get(id) as { vault_path: string | null } | undefined;
  if (!meeting) { res.status(404).json(fail('Meeting not found')); return; }
  getDb().prepare('DELETE FROM meeting_people WHERE meeting_id = ?').run(id);
  getDb().prepare('DELETE FROM agreements WHERE meeting_id = ?').run(id);
  getDb().prepare('DELETE FROM meetings WHERE id = ?').run(id);
  searchService.removeRecord('meeting', id);
  try { if (meeting.vault_path) obsidian.deleteFile(meeting.vault_path); } catch {}
  res.json(ok({ deleted: true }));
});

// Transcribe audio file and attach to meeting
meetingsRouter.post('/:id/transcribe', upload.single('audio'), async (req: Request, res: Response) => {
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
        await obsidian.writeMeeting({
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
