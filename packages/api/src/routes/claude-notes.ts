import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { queryAll, queryOne, execute } from '../db/db';
import { ok, fail } from '@pis/shared';

export const claudeNotesRouter = Router();

const CreateSchema = z.object({
  content: z.string().min(1),
  source: z.string().optional().default('api'),
});

claudeNotesRouter.get('/', async (req: Request, res: Response) => {
  const onlyPending = req.query['pending'] === 'true';
  const sql = onlyPending
    ? 'SELECT * FROM claude_notes WHERE processed = false ORDER BY created_at DESC'
    : 'SELECT * FROM claude_notes ORDER BY created_at DESC LIMIT 100';
  const notes = await queryAll(sql);
  res.json(ok(notes));
});

claudeNotesRouter.post('/', async (req: Request, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { content, source } = parsed.data;
  const inserted = await queryOne<{ id: number }>(
    'INSERT INTO claude_notes (content, source) VALUES ($1, $2) RETURNING id',
    [content, source]
  );
  if (!inserted) { res.status(500).json(fail('Insert failed')); return; }
  const note = await queryOne('SELECT * FROM claude_notes WHERE id = $1', [inserted.id]);
  res.status(201).json(ok(note));
});

claudeNotesRouter.patch('/:id', async (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  const { processed, vault_path } = req.body;
  const fields: string[] = [];
  const values: unknown[] = [];
  if (processed !== undefined) { fields.push(`processed = $${fields.length + 1}`); values.push(processed ? true : false); }
  if (vault_path !== undefined) { fields.push(`vault_path = $${fields.length + 1}`); values.push(vault_path); }
  if (fields.length === 0) { res.status(400).json(fail('No fields')); return; }
  await execute(`UPDATE claude_notes SET ${fields.join(', ')} WHERE id = $${values.length + 1}`, [...values, id]);
  const note = await queryOne('SELECT * FROM claude_notes WHERE id = $1', [id]);
  res.json(ok(note));
});

claudeNotesRouter.delete('/:id', async (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  await execute('DELETE FROM claude_notes WHERE id = $1', [id]);
  res.json(ok({ deleted: true }));
});
