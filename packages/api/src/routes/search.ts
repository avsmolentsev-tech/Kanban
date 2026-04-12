import { Router, Response } from 'express';
import { searchService } from '../services/search.service';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';
import type { AuthRequest } from '../middleware/auth';
import { getUserId } from '../middleware/user-scope';

export const searchRouter = Router();

searchRouter.get('/', (req: AuthRequest, res: Response) => {
  const q = req.query['q'];
  if (typeof q !== 'string' || !q.trim()) {
    res.status(400).json(fail('Query parameter q is required'));
    return;
  }
  const userId = getUserId(req);
  let results = searchService.search(q);

  // Filter results by user ownership (search_index has no user_id, so check source tables)
  if (userId != null) {
    const db = getDb();
    results = results.filter((r) => {
      try {
        const table = r.type === 'task' ? 'tasks' : r.type === 'meeting' ? 'meetings' : r.type === 'idea' ? 'ideas' : null;
        if (!table) return true; // unknown type — allow through
        const row = db.prepare(`SELECT user_id FROM ${table} WHERE id = ?`).get(r.ref_id) as { user_id: number | null } | undefined;
        return !row || row.user_id === null || row.user_id === userId;
      } catch {
        return true; // if table doesn't have user_id column, allow through
      }
    });
  }

  res.json(ok(results));
});

searchRouter.post('/reindex', (_req: AuthRequest, res: Response) => {
  const result = searchService.reindexAll();
  res.json(ok(result));
});
