import { Router, Response } from 'express';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import multer from 'multer';
import { queryAll, queryOne, execute } from '../db/db';
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

documentsRouter.get('/', async (req: AuthRequest, res: Response) => {
  const scope = userScopeWhere(req);
  // scope uses $1 for user_id; additional conditions use $2, $3...
  let sql = `SELECT * FROM documents WHERE ${scope.sql}`;
  const params: unknown[] = [...scope.params];
  if (req.query['project']) {
    params.push(Number(req.query['project']));
    sql += ` AND project_id = $${params.length}`;
  }
  if (req.query['category']) {
    params.push(req.query['category']);
    sql += ` AND category = $${params.length}`;
  }
  sql += ' ORDER BY updated_at DESC';
  const docs = await queryAll<Record<string, unknown>>(sql, params);

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

documentsRouter.post('/', async (req: AuthRequest, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const { title, body, project_id, parent_id, category, vault_path } = parsed.data;
  const userId = getUserId(req);
  const inserted = await queryOne<{ id: number }>(
    'INSERT INTO documents (title, body, project_id, parent_id, category, vault_path, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
    [title, body, project_id ?? null, parent_id ?? null, category, vault_path ?? null, userId]
  );
  searchService.indexRecord('document', inserted!.id, title, body ?? '');
  res.status(201).json(ok(await queryOne('SELECT * FROM documents WHERE id = $1', [inserted!.id])));
});

// Get ancestor chain for breadcrumbs (single request instead of N+1)
documentsRouter.get('/:id/ancestors', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  const docId = Number(req.params['id']);
  const chain: Array<{ id: number; title: string; parent_id: number | null }> = [];
  let currentId: number | null = docId;
  const seen = new Set<number>();
  while (currentId) {
    if (seen.has(currentId)) break; // cycle protection
    seen.add(currentId);
    const cid: number = currentId;
    const doc: { id: number; title: string; parent_id: number | null } | undefined = await queryOne<{ id: number; title: string; parent_id: number | null }>(
      'SELECT id, title, parent_id FROM documents WHERE id = $1 AND user_id = $2',
      [cid, userId]
    );
    if (!doc || doc.id === docId) { currentId = doc?.parent_id ?? null; continue; } // skip self
    chain.unshift(doc);
    currentId = doc.parent_id;
  }
  res.json(ok(chain));
});

// Serve attachment files — MUST be before /:id to avoid route conflict
documentsRouter.get('/attachments/file/:filename', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  // Verify the attachment belongs to a document owned by this user
  const att = await queryOne(
    'SELECT a.id FROM attachments a JOIN documents d ON d.id = a.document_id WHERE a.filename = $1 AND d.user_id = $2',
    [req.params['filename']!, userId]
  );
  if (!att) { res.status(404).json(fail('Файл не найден')); return; }
  const filePath = path.join(attachDir, req.params['filename']!);
  if (!fs.existsSync(filePath)) { res.status(404).json(fail('Файл не найден')); return; }
  res.sendFile(filePath);
});

documentsRouter.delete('/attachments/:attId', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  const att = await queryOne<{ id: number; filename: string }>(
    'SELECT a.id, a.filename FROM attachments a JOIN documents d ON d.id = a.document_id WHERE a.id = $1 AND d.user_id = $2',
    [Number(req.params['attId']), userId]
  );
  if (!att) { res.status(404).json(fail('Attachment not found')); return; }
  try { fs.unlinkSync(path.join(attachDir, att.filename)); } catch {}
  await execute('DELETE FROM attachments WHERE id = $1', [att.id]);
  res.json(ok({ deleted: true }));
});

documentsRouter.get('/:id', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  const doc = await queryOne('SELECT * FROM documents WHERE id = $1 AND user_id = $2', [Number(req.params['id']), userId]);
  if (!doc) { res.status(404).json(fail('Document not found')); return; }
  res.json(ok(doc));
});

documentsRouter.patch('/:id', async (req: AuthRequest, res: Response) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const userId = getUserId(req);
  const existing = await queryOne('SELECT id FROM documents WHERE id = $1 AND user_id = $2', [Number(req.params['id']), userId]);
  if (!existing) { res.status(404).json(fail('Document not found')); return; }
  const entries = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) { res.status(400).json(fail('No fields to update')); return; }
  const fields = entries.map(([k], i) => `${k} = $${i + 1}`);
  const values = entries.map(([, v]) => v);
  // add updated_at
  fields.push(`updated_at = $${entries.length + 1}`);
  values.push(new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
  const docId = Number(req.params['id']);
  await execute(
    `UPDATE documents SET ${fields.join(', ')} WHERE id = $${entries.length + 2}`,
    [...values, docId]
  );
  const updatedDoc = await queryOne<Record<string, unknown>>('SELECT * FROM documents WHERE id = $1', [docId]);
  if (updatedDoc) searchService.indexRecord('document', updatedDoc['id'] as number, updatedDoc['title'] as string, (updatedDoc['body'] as string) ?? '');

  // Sync to Obsidian vault
  if (updatedDoc) {
    const docStatus = updatedDoc['status'] as string;
    if (docStatus === 'in_obsidian' || docStatus === 'active') {
      syncDocToVault(docId, userId).catch(err => {
        console.warn('[documents] vault sync failed:', err);
      });
    }
  }

  res.json(ok(updatedDoc));
});

documentsRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  const id = Number(req.params['id']);
  const userId = getUserId(req);
  const existing = await queryOne('SELECT id FROM documents WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!existing) { res.status(404).json(fail('Document not found')); return; }
  // Unparent children so they don't become orphaned
  await execute('UPDATE documents SET parent_id = NULL WHERE parent_id = $1', [id]);
  // Delete attachments
  const atts = await queryAll<{ filename: string }>('SELECT filename FROM attachments WHERE document_id = $1', [id]);
  for (const a of atts) { try { fs.unlinkSync(path.join(attachDir, a.filename)); } catch {} }
  await execute('DELETE FROM attachments WHERE document_id = $1', [id]);
  await execute('DELETE FROM documents WHERE id = $1', [id]);
  res.json(ok({ deleted: true }));
});

// Attachments
documentsRouter.post('/:id/attachments', upload.single('file'), async (req: AuthRequest, res: Response) => {
  const docId = Number(req.params['id']);
  const userId = getUserId(req);
  const doc = await queryOne('SELECT id FROM documents WHERE id = $1 AND user_id = $2', [docId, userId]);
  if (!doc) { res.status(404).json(fail('Document not found')); return; }
  if (!req.file) { res.status(400).json(fail('Файл не предоставлен')); return; }

  const ext = path.extname(req.file.originalname);
  const filename = `${docId}-${Date.now()}${ext}`;
  fs.writeFileSync(path.join(attachDir, filename), req.file.buffer);

  const inserted = await queryOne<{ id: number }>(
    'INSERT INTO attachments (document_id, filename, original_name, size, mime_type) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [docId, filename, req.file.originalname, req.file.size, req.file.mimetype]
  );
  const attachment = await queryOne('SELECT * FROM attachments WHERE id = $1', [inserted!.id]);
  res.status(201).json(ok(attachment));
});

documentsRouter.get('/:id/attachments', async (req: AuthRequest, res: Response) => {
  const docId = Number(req.params['id']);
  const userId = getUserId(req);
  const doc = await queryOne('SELECT id FROM documents WHERE id = $1 AND user_id = $2', [docId, userId]);
  if (!doc) { res.status(404).json(fail('Document not found')); return; }
  const atts = await queryAll('SELECT * FROM attachments WHERE document_id = $1 ORDER BY created_at DESC', [docId]);
  res.json(ok(atts));
});
