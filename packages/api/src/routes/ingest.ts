import { Router, Response } from 'express';
import multer from 'multer';
import { IngestService } from '../services/ingest.service';
import { getDb } from '../db/db';
import { config } from '../config';
import { ok, fail } from '@pis/shared';
import type { AuthRequest } from '../middleware/auth';
import { getUserId } from '../middleware/user-scope';

export const ingestRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxFileSizeMb * 1024 * 1024 } });
const ingestService = new IngestService();

ingestRouter.get('/', (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  const userFilter = userId != null ? ' WHERE user_id = ?' : '';
  const userParams = userId != null ? [userId] : [];
  const items = getDb().prepare(`SELECT * FROM inbox_items${userFilter} ORDER BY created_at DESC LIMIT 50`).all(...userParams);
  res.json(ok(items));
});

ingestRouter.post('/', upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    let result;
    if (req.file) {
      result = await ingestService.ingestBuffer(req.file.buffer, req.file.originalname);
    } else if (typeof req.body['text'] === 'string') {
      result = await ingestService.ingestText(req.body['text'] as string);
    } else if (typeof req.body['url'] === 'string') {
      // URL ingestion - parse URL directly
      const { parseUrl } = require('../parsers');
      const text = await parseUrl(req.body['url']);
      result = await ingestService.ingestBuffer(Buffer.from(text, 'utf-8'), req.body['url']);
    } else {
      res.status(400).json(fail('Provide a file or text field'));
      return;
    }

    // Associate created records with the current user and optional project
    const projectId = req.body['project_id'] ? Number(req.body['project_id']) : null;
    const db = getDb();
    for (const record of result.created_records) {
      if (record.type === 'meeting') {
        if (userId != null) db.prepare('UPDATE meetings SET user_id = ? WHERE id = ?').run(userId, record.id);
        if (projectId) db.prepare('UPDATE meetings SET project_id = ? WHERE id = ?').run(projectId, record.id);
      } else if (record.type === 'task') {
        if (userId != null) db.prepare('UPDATE tasks SET user_id = ? WHERE id = ?').run(userId, record.id);
        if (projectId) db.prepare('UPDATE tasks SET project_id = ? WHERE id = ?').run(projectId, record.id);
      }
      // ideas table may not have project_id; skip silently
    }

    res.status(201).json(ok(result));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Ingest failed'));
  }
});

ingestRouter.get('/status/:id', (req: AuthRequest, res: Response) => {
  const item = ingestService.getStatus(Number(req.params['id']));
  if (!item) { res.status(404).json(fail('Inbox item not found')); return; }
  res.json(ok(item));
});

ingestRouter.delete('/:id', (req: AuthRequest, res: Response) => {
  const id = Number(req.params['id']);
  const item = getDb().prepare('SELECT * FROM inbox_items WHERE id = ?').get(id);
  if (!item) { res.status(404).json(fail('Inbox item not found')); return; }
  getDb().prepare('DELETE FROM inbox_items WHERE id = ?').run(id);
  res.json(ok({ deleted: true }));
});
