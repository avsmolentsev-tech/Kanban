import { Router, Request, Response } from 'express';
import { searchService } from '../services/search.service';
import { ok, fail } from '@pis/shared';

export const searchRouter = Router();

searchRouter.get('/', (req: Request, res: Response) => {
  const q = req.query['q'];
  if (typeof q !== 'string' || !q.trim()) {
    res.status(400).json(fail('Query parameter q is required'));
    return;
  }
  const results = searchService.search(q);
  res.json(ok(results));
});

searchRouter.post('/reindex', (_req: Request, res: Response) => {
  const result = searchService.reindexAll();
  res.json(ok(result));
});
