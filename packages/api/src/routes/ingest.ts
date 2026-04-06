import { Router, Request, Response } from 'express';
import multer from 'multer';
import { IngestService } from '../services/ingest.service';
import { getDb } from '../db/db';
import { config } from '../config';
import { ok, fail } from '@pis/shared';

export const ingestRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxFileSizeMb * 1024 * 1024 } });
const ingestService = new IngestService();

ingestRouter.get('/', (_req: Request, res: Response) => {
  const items = getDb().prepare('SELECT * FROM inbox_items ORDER BY created_at DESC LIMIT 50').all();
  res.json(ok(items));
});

ingestRouter.post('/', upload.single('file'), async (req: Request, res: Response) => {
  try {
    let result;
    if (req.file) {
      result = await ingestService.ingestBuffer(req.file.buffer, req.file.originalname);
    } else if (typeof req.body['text'] === 'string') {
      result = await ingestService.ingestText(req.body['text'] as string);
    } else {
      res.status(400).json(fail('Provide a file or text field'));
      return;
    }

    // If project_id was provided, associate created records with the project
    const projectId = req.body['project_id'] ? Number(req.body['project_id']) : null;
    if (projectId) {
      const db = getDb();
      for (const record of result.created_records) {
        if (record.type === 'meeting') {
          db.prepare('UPDATE meetings SET project_id = ? WHERE id = ?').run(projectId, record.id);
        } else if (record.type === 'task') {
          db.prepare('UPDATE tasks SET project_id = ? WHERE id = ?').run(projectId, record.id);
        }
        // ideas table may not have project_id; skip silently
      }
    }

    res.status(201).json(ok(result));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Ingest failed'));
  }
});

ingestRouter.get('/status/:id', (req: Request, res: Response) => {
  const item = ingestService.getStatus(Number(req.params['id']));
  if (!item) { res.status(404).json(fail('Inbox item not found')); return; }
  res.json(ok(item));
});
