import { Router, Response } from 'express';
import { z } from 'zod';
import { queryAll, queryOne, execute } from '../db/db';
import { ok, fail } from '@pis/shared';
import type { AuthRequest } from '../middleware/auth';
import { getUserId } from '../middleware/user-scope';

export const claudeNotesRouter = Router();

const CreateSchema = z.object({
  content: z.string().min(1),
  source: z.string().optional().default('api'),
});

claudeNotesRouter.get('/', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  const onlyPending = req.query['pending'] === 'true';
  const sql = onlyPending
    ? 'SELECT * FROM claude_notes WHERE processed = 0 AND user_id = $1 ORDER BY created_at DESC'
    : 'SELECT * FROM claude_notes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100';
  const notes = await queryAll(sql, [userId]);
  res.json(ok(notes));
});

claudeNotesRouter.post('/', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { content, source } = parsed.data;
  const inserted = await queryOne<{ id: number }>(
    'INSERT INTO claude_notes (content, source, user_id) VALUES ($1, $2, $3) RETURNING id',
    [content, source, userId]
  );
  if (!inserted) { res.status(500).json(fail('Insert failed')); return; }
  const note = await queryOne('SELECT * FROM claude_notes WHERE id = $1 AND user_id = $2', [inserted.id, userId]);
  res.status(201).json(ok(note));
});

claudeNotesRouter.patch('/:id', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  const id = Number(req.params['id']);
  const { processed, vault_path } = req.body;
  const fields: string[] = [];
  const values: unknown[] = [];
  if (processed !== undefined) { fields.push(`processed = $${fields.length + 1}`); values.push(processed ? true : false); }
  if (vault_path !== undefined) { fields.push(`vault_path = $${fields.length + 1}`); values.push(vault_path); }
  if (fields.length === 0) { res.status(400).json(fail('No fields')); return; }
  // Scope the UPDATE to the owner: id is $N+1, user_id is $N+2
  await execute(
    `UPDATE claude_notes SET ${fields.join(', ')} WHERE id = $${values.length + 1} AND user_id = $${values.length + 2}`,
    [...values, id, userId]
  );
  const note = await queryOne('SELECT * FROM claude_notes WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!note) { res.status(404).json(fail('Note not found')); return; }
  res.json(ok(note));
});

claudeNotesRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  const id = Number(req.params['id']);
  await execute('DELETE FROM claude_notes WHERE id = $1 AND user_id = $2', [id, userId]);
  res.json(ok({ deleted: true }));
});
