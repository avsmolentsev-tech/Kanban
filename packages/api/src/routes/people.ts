import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';

export const peopleRouter = Router();

const CreateSchema = z.object({
  name: z.string().min(1), company: z.string().optional().default(''), role: z.string().optional().default(''),
  telegram: z.string().optional().default(''), email: z.string().optional().default(''),
  phone: z.string().optional().default(''), notes: z.string().optional().default(''),
});

peopleRouter.get('/', (_req: Request, res: Response) => {
  res.json(ok(getDb().prepare('SELECT * FROM people ORDER BY name ASC').all()));
});

peopleRouter.post('/', (req: Request, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { name, company, role, telegram, email, phone, notes } = parsed.data;
  const result = getDb().prepare('INSERT INTO people (name, company, role, telegram, email, phone, notes) VALUES (?, ?, ?, ?, ?, ?, ?)').run(name, company, role, telegram, email, phone, notes);
  res.status(201).json(ok(getDb().prepare('SELECT * FROM people WHERE id = ?').get(result.lastInsertRowid)));
});

peopleRouter.get('/:id/history', (req: Request, res: Response) => {
  const person = getDb().prepare('SELECT * FROM people WHERE id = ?').get(Number(req.params['id']));
  if (!person) { res.status(404).json(fail('Person not found')); return; }
  const meetings = getDb().prepare('SELECT m.id, m.title, m.date FROM meetings m JOIN meeting_people mp ON m.id = mp.meeting_id WHERE mp.person_id = ? ORDER BY m.date DESC').all(Number(req.params['id']));
  const agreements = getDb().prepare('SELECT * FROM agreements WHERE person_id = ? ORDER BY created_at DESC').all(Number(req.params['id']));
  const tasks = getDb().prepare('SELECT t.id, t.title, t.status FROM tasks t JOIN task_people tp ON t.id = tp.task_id WHERE tp.person_id = ?').all(Number(req.params['id']));
  res.json(ok({ person, meetings, agreements, tasks }));
});
