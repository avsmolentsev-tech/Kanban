import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';

export const documentsRouter = Router();

const CreateSchema = z.object({
  title: z.string().min(1),
  body: z.string().optional().default(''),
  project_id: z.number().int().nullable().optional(),
  category: z.enum(['note', 'reference', 'template', 'archive']).optional().default('note'),
  vault_path: z.string().nullable().optional(),
});

const UpdateSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  project_id: z.number().int().nullable().optional(),
  category: z.enum(['note', 'reference', 'template', 'archive']).optional(),
  vault_path: z.string().nullable().optional(),
});

documentsRouter.get('/', (req: Request, res: Response) => {
  let query = 'SELECT * FROM documents WHERE 1=1';
  const params: unknown[] = [];
  if (req.query['project']) { query += ' AND project_id = ?'; params.push(Number(req.query['project'])); }
  if (req.query['category']) { query += ' AND category = ?'; params.push(req.query['category']); }
  query += ' ORDER BY updated_at DESC';
  res.json(ok(getDb().prepare(query).all(...params)));
});

documentsRouter.post('/', (req: Request, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { title, body, project_id, category, vault_path } = parsed.data;
  const result = getDb()
    .prepare('INSERT INTO documents (title, body, project_id, category, vault_path) VALUES (?, ?, ?, ?, ?)')
    .run(title, body, project_id ?? null, category, vault_path ?? null);
  res.status(201).json(ok(getDb().prepare('SELECT * FROM documents WHERE id = ?').get(result.lastInsertRowid)));
});

documentsRouter.get('/:id', (req: Request, res: Response) => {
  const doc = getDb().prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params['id']));
  if (!doc) { res.status(404).json(fail('Document not found')); return; }
  res.json(ok(doc));
});

documentsRouter.patch('/:id', (req: Request, res: Response) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const fields = Object.entries(parsed.data)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => `${k} = ?`);
  const values = Object.values(parsed.data).filter((v) => v !== undefined);
  if (fields.length === 0) { res.status(400).json(fail('No fields to update')); return; }
  fields.push('updated_at = ?');
  values.push(new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
  getDb()
    .prepare(`UPDATE documents SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values, Number(req.params['id']));
  res.json(ok(getDb().prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params['id']))));
});

documentsRouter.delete('/:id', (req: Request, res: Response) => {
  getDb().prepare('DELETE FROM documents WHERE id = ?').run(Number(req.params['id']));
  res.json(ok({ deleted: true }));
});
