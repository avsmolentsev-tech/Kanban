import { Router, Response } from 'express';
import { queryAll } from '../db/db';
import { ok, fail } from '@pis/shared';
import type { AuthRequest } from '../middleware/auth';
import { getUserId } from '../middleware/user-scope';

export const searchRouter = Router();

interface SearchResult {
  type: string;
  ref_id: number;
  title: string;
  snippet?: string;
  rank?: number;
}

searchRouter.get('/', async (req: AuthRequest, res: Response) => {
  const q = req.query['q'];
  if (typeof q !== 'string' || !q.trim()) {
    res.status(400).json(fail('Query parameter q is required'));
    return;
  }
  const userId = getUserId(req);
  const userFilter = userId != null ? ' AND user_id = $2' : '';
  const userParams = userId != null ? [q, userId] : [q];

  try {
    // Full-text search on tasks via tsvector column
    const tasks = await queryAll<SearchResult>(
      `SELECT 'task' AS type, id AS ref_id, title,
        ts_rank(search_vector, plainto_tsquery('russian', $1)) AS rank
       FROM tasks
       WHERE archived = 0
         AND search_vector @@ plainto_tsquery('russian', $1)
         ${userFilter}
       ORDER BY rank DESC
       LIMIT 20`,
      userParams
    );

    // ILIKE search on meetings
    const meetings = await queryAll<SearchResult>(
      `SELECT 'meeting' AS type, id AS ref_id, title, NULL AS rank
       FROM meetings
       WHERE title ILIKE '%' || $1 || '%'
         ${userFilter}
       LIMIT 10`,
      userParams
    );

    // ILIKE search on people
    const people = await queryAll<SearchResult>(
      `SELECT 'person' AS type, id AS ref_id, name AS title, NULL AS rank
       FROM people
       WHERE name ILIKE '%' || $1 || '%'
         ${userFilter}
       LIMIT 10`,
      userParams
    );

    // ILIKE search on ideas
    const ideas = await queryAll<SearchResult>(
      `SELECT 'idea' AS type, id AS ref_id, title, NULL AS rank
       FROM ideas
       WHERE archived = 0
         AND title ILIKE '%' || $1 || '%'
         ${userFilter}
       LIMIT 10`,
      userParams
    );

    // ILIKE search on documents
    const documents = await queryAll<SearchResult>(
      `SELECT 'document' AS type, id AS ref_id, title, NULL AS rank
       FROM documents
       WHERE title ILIKE '%' || $1 || '%'
         ${userFilter}
       LIMIT 10`,
      userParams
    );

    const results: SearchResult[] = [...tasks, ...meetings, ...people, ...ideas, ...documents];
    res.json(ok(results));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Search error'));
  }
});

searchRouter.post('/reindex', (_req: AuthRequest, res: Response) => {
  // Full-text search is handled natively by PostgreSQL via search_vector column.
  // No manual reindex needed — tsvector is updated by DB triggers/generated column.
  res.json(ok({ message: 'PostgreSQL tsvector is always up to date' }));
});
