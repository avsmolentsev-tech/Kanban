import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';

export const peopleRouter = Router();

const CreateSchema = z.object({
  name: z.string().min(1), company: z.string().optional().default(''), role: z.string().optional().default(''),
  telegram: z.string().optional().default(''), email: z.string().optional().default(''),
  phone: z.string().optional().default(''), notes: z.string().optional().default(''),
  project_id: z.number().nullable().optional().default(null),
});

peopleRouter.get('/', (_req: Request, res: Response) => {
  res.json(ok(getDb().prepare('SELECT * FROM people ORDER BY project_id ASC, name ASC').all()));
});

peopleRouter.post('/', (req: Request, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { name, company, role, telegram, email, phone, notes, project_id } = parsed.data;
  const result = getDb().prepare('INSERT INTO people (name, company, role, telegram, email, phone, notes, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(name, company, role, telegram, email, phone, notes, project_id ?? null);
  res.status(201).json(ok(getDb().prepare('SELECT * FROM people WHERE id = ?').get(result.lastInsertRowid)));
});

const UpdatePersonSchema = z.object({
  name: z.string().min(1).optional(),
  company: z.string().optional(),
  role: z.string().optional(),
  telegram: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  notes: z.string().optional(),
  project_id: z.number().int().nullable().optional(),
});

peopleRouter.patch('/:id', (req: Request, res: Response) => {
  const parsed = UpdatePersonSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const fields = Object.entries(parsed.data).filter(([, v]) => v !== undefined).map(([k]) => `${k} = ?`);
  const values = Object.values(parsed.data).filter((v) => v !== undefined);
  if (fields.length === 0) { res.status(400).json(fail('No fields')); return; }
  getDb().prepare(`UPDATE people SET ${fields.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`).run(...values, Number(req.params['id']));
  res.json(ok(getDb().prepare('SELECT * FROM people WHERE id = ?').get(Number(req.params['id']))));
});

peopleRouter.get('/:id/history', (req: Request, res: Response) => {
  const person = getDb().prepare('SELECT * FROM people WHERE id = ?').get(Number(req.params['id']));
  if (!person) { res.status(404).json(fail('Person not found')); return; }
  const meetings = getDb().prepare('SELECT m.id, m.title, m.date FROM meetings m JOIN meeting_people mp ON m.id = mp.meeting_id WHERE mp.person_id = ? ORDER BY m.date DESC').all(Number(req.params['id']));
  const agreements = getDb().prepare('SELECT * FROM agreements WHERE person_id = ? ORDER BY created_at DESC').all(Number(req.params['id']));
  const tasks = getDb().prepare('SELECT t.id, t.title, t.status FROM tasks t JOIN task_people tp ON t.id = tp.task_id WHERE tp.person_id = ?').all(Number(req.params['id']));
  res.json(ok({ person, meetings, agreements, tasks }));
});
