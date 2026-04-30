import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import multer from 'multer';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';
import { searchService } from '../services/search.service';
import { config } from '../config';

import type { AuthRequest } from '../middleware/auth';
import { getUserId, userScopeWhere } from '../middleware/user-scope';
import { syncDocToVault } from '../services/obsidian-sync.service';

const attachDir = path.join(config.vaultPath, 'Attachments');
if (!fs.existsSync(attachDir)) fs.mkdirSync(attachDir, { recursive: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export const documentsRouter = Router();

const DOC_STATUSES = ['draft', 'active', 'in_obsidian', 'archive'] as const;

const CreateSchema = z.object({
  title: z.string().min(1),
  body: z.string().optional().default(''),
  project_id: z.number().int().nullable().optional(),
  parent_id: z.number().int().nullable().optional(),
  category: z.enum(['note', 'reference', 'template', 'archive']).optional().default('note'),
  vault_path: z.string().nullable().optional(),
  status: z.enum(DOC_STATUSES).optional().default('draft'),
});

const UpdateSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  project_id: z.number().int().nullable().optional(),
  parent_id: z.number().int().nullable().optional(),
  category: z.enum(['note', 'reference', 'template', 'archive']).optional(),
  vault_path: z.string().nullable().optional(),
  status: z.enum(DOC_STATUSES).optional(),
});

documentsRouter.get('/', (req: AuthRequest, res: Response) => {
  const scope = userScopeWhere(req);
  let query = `SELECT * FROM documents WHERE ${scope.sql}`;
  const params: unknown[] = [...scope.params];
  if (req.query['project']) { query += ' AND project_id = ?'; params.push(Number(req.query['project'])); }
  if (req.query['category']) { query += ' AND category = ?'; params.push(req.query['category']); }
  query += ' ORDER BY updated_at DESC';
  const docs = getDb().prepare(query).all(...params) as Array<Record<string, unknown>>;

  if (req.query['tree'] === 'true') {
    const map = new Map<number, Record<string, unknown> & { children: unknown[] }>();
    const roots: Array<Record<string, unknown> & { children: unknown[] }> = [];
    for (const d of docs) {
      const node = { ...d, children: [] as unknown[] };
      map.set(d['id'] as number, node);
    }
    for (const node of map.values()) {
      const parentId = node['parent_id'] as number | null;
      if (parentId && map.has(parentId)) {
        map.get(parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    res.json(ok(roots));
    return;
  }

  res.json(ok(docs));
});

documentsRouter.post('/', (req: AuthRequest, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { title, body, project_id, parent_id, category, vault_path } = parsed.data;
  const userId = getUserId(req);
  const result = getDb()
    .prepare('INSERT INTO documents (title, body, project_id, parent_id, category, vault_path, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(title, body, project_id ?? null, parent_id ?? null, category, vault_path ?? null, userId);
  searchService.indexRecord('document', Number(result.lastInsertRowid), title, body ?? '');
  res.status(201).json(ok(getDb().prepare('SELECT * FROM documents WHERE id = ?').get(result.lastInsertRowid)));
});

// Serve attachment files — MUST be before /:id to avoid route conflict
documentsRouter.get('/attachments/file/:filename', (req: AuthRequest, res: Response) => {
  const filePath = path.join(attachDir, req.params['filename']!);
  if (!fs.existsSync(filePath)) { res.status(404).json(fail('Файл не найден')); return; }
  res.sendFile(filePath);
});

documentsRouter.delete('/attachments/:attId', (req: AuthRequest, res: Response) => {
  const att = getDb().prepare('SELECT * FROM attachments WHERE id = ?').get(Number(req.params['attId'])) as { filename: string } | undefined;
  if (att) {
    try { fs.unlinkSync(path.join(attachDir, att.filename)); } catch {}
    getDb().prepare('DELETE FROM attachments WHERE id = ?').run(Number(req.params['attId']));
  }
  res.json(ok({ deleted: true }));
});

documentsRouter.get('/:id', (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  const doc = getDb().prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?').get(Number(req.params['id']), userId);
  if (!doc) { res.status(404).json(fail('Document not found')); return; }
  res.json(ok(doc));
});

documentsRouter.patch('/:id', (req: AuthRequest, res: Response) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const userId = getUserId(req);
  const existing = getDb().prepare('SELECT id FROM documents WHERE id = ? AND user_id = ?').get(Number(req.params['id']), userId);
  if (!existing) { res.status(404).json(fail('Document not found')); return; }
  const fields = Object.entries(parsed.data)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => `${k} = ?`);
  const values = Object.values(parsed.data).filter((v) => v !== undefined);
  if (fields.length === 0) { res.status(400).json(fail('No fields to update')); return; }
  fields.push('updated_at = ?');
  values.push(new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
  const docId = Number(req.params['id']);
  getDb()
    .prepare(`UPDATE documents SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values, docId);
  const updatedDoc = getDb().prepare('SELECT * FROM documents WHERE id = ?').get(docId) as Record<string, unknown>;
  if (updatedDoc) searchService.indexRecord('document', updatedDoc['id'] as number, updatedDoc['title'] as string, (updatedDoc['body'] as string) ?? '');

  // Sync to Obsidian vault
  if (updatedDoc) {
    const docStatus = updatedDoc['status'] as string;
    if (docStatus === 'in_obsidian' || docStatus === 'active') {
      try {
        syncDocToVault(docId, userId);
      } catch (err) {
        console.warn('[documents] vault sync failed:', err);
      }
    }
  }

  res.json(ok(updatedDoc));
});

documentsRouter.delete('/:id', (req: AuthRequest, res: Response) => {
  const id = Number(req.params['id']);
  const userId = getUserId(req);
  const existing = getDb().prepare('SELECT id FROM documents WHERE id = ? AND user_id = ?').get(id, userId);
  if (!existing) { res.status(404).json(fail('Document not found')); return; }
  // Delete attachments
  const atts = getDb().prepare('SELECT filename FROM attachments WHERE document_id = ?').all(id) as Array<{ filename: string }>;
  for (const a of atts) { try { fs.unlinkSync(path.join(attachDir, a.filename)); } catch {} }
  getDb().prepare('DELETE FROM attachments WHERE document_id = ?').run(id);
  getDb().prepare('DELETE FROM documents WHERE id = ?').run(id);
  res.json(ok({ deleted: true }));
});

// Attachments
documentsRouter.post('/:id/attachments', upload.single('file'), (req: AuthRequest, res: Response) => {
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

documentsRouter.get('/:id/attachments', (req: AuthRequest, res: Response) => {
  const atts = getDb().prepare('SELECT * FROM attachments WHERE document_id = ? ORDER BY created_at DESC').all(Number(req.params['id']));
  res.json(ok(atts));
});

