import { Router, Response } from 'express';
import multer from 'multer';
import { IngestService } from '../services/ingest.service';
import { queryAll, queryOne, execute } from '../db/db';
import { config } from '../config';
import { ok, fail } from '@pis/shared';
import type { AuthRequest } from '../middleware/auth';
import { getUserId } from '../middleware/user-scope';

export const ingestRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxFileSizeMb * 1024 * 1024 } });
const ingestService = new IngestService();

ingestRouter.get('/', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  const sql = userId != null
    ? 'SELECT * FROM inbox_items WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50'
    : 'SELECT * FROM inbox_items ORDER BY created_at DESC LIMIT 50';
  const userParams = userId != null ? [userId] : [];
  const items = await queryAll(sql, userParams);
  res.json(ok(items));
});

ingestRouter.post('/', upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (userId == null) { res.status(401).json(fail('Authentication required')); return; }
    let result;
    if (req.file) {
      result = await ingestService.ingestBuffer(req.file.buffer, req.file.originalname, userId);
    } else if (typeof req.body['text'] === 'string') {
      result = await ingestService.ingestText(req.body['text'] as string, userId);
    } else if (typeof req.body['url'] === 'string') {
      const { parseUrl } = require('../parsers');
      const text = await parseUrl(req.body['url']);
      result = await ingestService.ingestBuffer(Buffer.from(text, 'utf-8'), req.body['url'], userId);
    } else {
      res.status(400).json(fail('Provide a file or text field'));
      return;
    }

    const projectId = req.body['project_id'] ? Number(req.body['project_id']) : null;
    if (projectId) {
      const owns = await queryOne('SELECT 1 FROM projects WHERE id = $1 AND user_id = $2', [projectId, userId]);
      if (owns) {
        for (const record of result.created_records) {
          if (record.type === 'meeting') {
            await execute('UPDATE meetings SET project_id = $1 WHERE id = $2 AND user_id = $3', [projectId, record.id, userId]);
          } else if (record.type === 'task') {
            await execute('UPDATE tasks SET project_id = $1 WHERE id = $2 AND user_id = $3', [projectId, record.id, userId]);
          }
        }
      }
    }

    res.status(201).json(ok(result));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Ingest failed'));
  }
});

ingestRouter.get('/status/:id', async (req: AuthRequest, res: Response) => {
  const item = await ingestService.getStatus(Number(req.params['id']));
  if (!item) { res.status(404).json(fail('Inbox item not found')); return; }
  res.json(ok(item));
});

ingestRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  const id = Number(req.params['id']);
  const userId = getUserId(req);
  const item = await queryOne('SELECT * FROM inbox_items WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!item) { res.status(404).json(fail('Inbox item not found')); return; }
  await execute('DELETE FROM inbox_items WHERE id = $1 AND user_id = $2', [id, userId]);
  res.json(ok({ deleted: true }));
});
