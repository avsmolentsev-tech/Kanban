import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';

export const claudeNotesRouter = Router();

const CreateSchema = z.object({
  content: z.string().min(1),
  source: z.string().optional().default('api'),
});

claudeNotesRouter.get('/', (req: Request, res: Response) => {
  const onlyPending = req.query['pending'] === 'true';
  const query = onlyPending
    ? 'SELECT * FROM claude_notes WHERE processed = 0 ORDER BY created_at DESC'
    : 'SELECT * FROM claude_notes ORDER BY created_at DESC LIMIT 100';
  const notes = getDb().prepare(query).all();
  res.json(ok(notes));
});

claudeNotesRouter.post('/', (req: Request, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { content, source } = parsed.data;
  const result = getDb().prepare('INSERT INTO claude_notes (content, source) VALUES (?, ?)').run(content, source);
  const note = getDb().prepare('SELECT * FROM claude_notes WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(ok(note));
});

claudeNotesRouter.patch('/:id', (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  const { processed, vault_path } = req.body;
  const fields: string[] = [];
  const values: unknown[] = [];
  if (processed !== undefined) { fields.push('processed = ?'); values.push(processed ? 1 : 0); }
  if (vault_path !== undefined) { fields.push('vault_path = ?'); values.push(vault_path); }
  if (fields.length === 0) { res.status(400).json(fail('No fields')); return; }
  getDb().prepare(`UPDATE claude_notes SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  const note = getDb().prepare('SELECT * FROM claude_notes WHERE id = ?').get(id);
  res.json(ok(note));
});

claudeNotesRouter.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  getDb().prepare('DELETE FROM claude_notes WHERE id = ?').run(id);
  res.json(ok({ deleted: true }));
});
