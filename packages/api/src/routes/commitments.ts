import { Router, Response } from 'express';
import { queryAll } from '../db/db';
import { ok, fail } from '@pis/shared';
import type { AuthRequest } from '../middleware/auth';
import { getUserId } from '../middleware/user-scope';

export const commitmentsRouter = Router();

interface CommitmentRow {
  id: number; title: string; status: string; due_date: string | null;
  commitment_type: string; commitment_owner: string | null;
  source_meeting_id: number | null; meeting_title: string | null; meeting_date: string | null;
}

// GET /commitments — action items extracted from meetings, split into mine vs theirs
commitmentsRouter.get('/', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  try {
    const rows = await queryAll<CommitmentRow>(
      `SELECT t.id, t.title, t.status, t.due_date, t.commitment_type, t.commitment_owner,
              t.source_meeting_id, m.title AS meeting_title, m.date AS meeting_date
       FROM tasks t
       LEFT JOIN meetings m ON m.id = t.source_meeting_id
       WHERE t.commitment_type IS NOT NULL AND t.archived = 0 AND t.user_id IS NOT DISTINCT FROM $1
       ORDER BY t.created_at DESC`,
      [userId]
    );
    const today = new Date().toISOString().slice(0, 10);
    const withStatus = rows.map(r => ({
      ...r,
      tracker_status: r.status === 'done' ? 'done'
        : (r.due_date && r.due_date < today ? 'overdue' : 'pending'),
    }));
    // "mine" = what I owe; "theirs" = what others promised (their_commitment + mutual_agreement)
    const mine = withStatus.filter(r => r.commitment_type === 'my_task');
    const theirs = withStatus.filter(r => r.commitment_type !== 'my_task');
    res.json(ok({ mine, theirs }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Commitments error'));
  }
});
