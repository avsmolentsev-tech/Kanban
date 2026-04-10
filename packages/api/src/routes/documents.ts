import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import multer from 'multer';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';
import { searchService } from '../services/search.service';
import { config } from '../config';

const attachDir = path.join(config.vaultPath, 'Attachments');
if (!fs.existsSync(attachDir)) fs.mkdirSync(attachDir, { recursive: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export const documentsRouter = Router();

const DOC_STATUSES = ['draft', 'active', 'in_obsidian', 'archive'] as const;

const CreateSchema = z.object({
  title: z.string().min(1),
  body: z.string().optional().default(''),
  project_id: z.number().int().nullable().optional(),
  category: z.enum(['note', 'reference', 'template', 'archive']).optional().default('note'),
  vault_path: z.string().nullable().optional(),
  status: z.enum(DOC_STATUSES).optional().default('draft'),
});

const UpdateSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  project_id: z.number().int().nullable().optional(),
  category: z.enum(['note', 'reference', 'template', 'archive']).optional(),
  vault_path: z.string().nullable().optional(),
  status: z.enum(DOC_STATUSES).optional(),
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
  searchService.indexRecord('document', Number(result.lastInsertRowid), title, body ?? '');
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
  const updatedDoc = getDb().prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params['id'])) as any;
  if (updatedDoc) searchService.indexRecord('document', updatedDoc.id, updatedDoc.title, updatedDoc.body ?? '');
  res.json(ok(updatedDoc));
});

documentsRouter.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  // Delete attachments
  const atts = getDb().prepare('SELECT filename FROM attachments WHERE document_id = ?').all(id) as Array<{ filename: string }>;
  for (const a of atts) { try { fs.unlinkSync(path.join(attachDir, a.filename)); } catch {} }
  getDb().prepare('DELETE FROM attachments WHERE document_id = ?').run(id);
  getDb().prepare('DELETE FROM documents WHERE id = ?').run(id);
  res.json(ok({ deleted: true }));
});

// Attachments
documentsRouter.post('/:id/attachments', upload.single('file'), (req: Request, res: Response) => {
  const docId = Number(req.params['id']);
  if (!req.file) { res.status(400).json(fail('Файл не предоставлен')); return; }

  const ext = path.extname(req.file.originalname);
  const filename = `${docId}-${Date.now()}${ext}`;
  fs.writeFileSync(path.join(attachDir, filename), req.file.buffer);

  const result = getDb().prepare('INSERT INTO attachments (document_id, filename, original_name, size, mime_type) VALUES (?, ?, ?, ?, ?)').run(
    docId, filename, req.file.originalname, req.file.size, req.file.mimetype
  );
  const attachment = getDb().prepare('SELECT * FROM attachments WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(ok(attachment));
});

documentsRouter.get('/:id/attachments', (req: Request, res: Response) => {
  const atts = getDb().prepare('SELECT * FROM attachments WHERE document_id = ? ORDER BY created_at DESC').all(Number(req.params['id']));
  res.json(ok(atts));
});

documentsRouter.delete('/attachments/:attId', (req: Request, res: Response) => {
  const att = getDb().prepare('SELECT * FROM attachments WHERE id = ?').get(Number(req.params['attId'])) as { filename: string } | undefined;
  if (att) {
    try { fs.unlinkSync(path.join(attachDir, att.filename)); } catch {}
    getDb().prepare('DELETE FROM attachments WHERE id = ?').run(Number(req.params['attId']));
  }
  res.json(ok({ deleted: true }));
});

// Serve attachment files
documentsRouter.get('/attachments/file/:filename', (req: Request, res: Response) => {
  const filePath = path.join(attachDir, req.params['filename']!);
  if (!fs.existsSync(filePath)) { res.status(404).json(fail('Файл не найден')); return; }
  res.sendFile(filePath);
});
