import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';

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

meetingsRouter.post('/', (req: Request, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { title, date, project_id, summary_raw } = parsed.data;
  const result = getDb().prepare('INSERT INTO meetings (title, date, project_id, summary_raw) VALUES (?, ?, ?, ?)').run(title, date, project_id ?? null, summary_raw);
  res.status(201).json(ok(getDb().prepare('SELECT * FROM meetings WHERE id = ?').get(result.lastInsertRowid)));
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
  res.json(ok(getDb().prepare('SELECT * FROM meetings WHERE id = ?').get(id)));
});

meetingsRouter.get('/:id', (req: Request, res: Response) => {
  const meeting = getDb().prepare('SELECT * FROM meetings WHERE id = ?').get(Number(req.params['id']));
  if (!meeting) { res.status(404).json(fail('Meeting not found')); return; }
  const agreements = getDb().prepare('SELECT * FROM agreements WHERE meeting_id = ?').all(Number(req.params['id']));
  const people = getDb().prepare('SELECT p.* FROM people p JOIN meeting_people mp ON p.id = mp.person_id WHERE mp.meeting_id = ?').all(Number(req.params['id']));
  res.json(ok({ ...meeting as object, agreements, people }));
});
