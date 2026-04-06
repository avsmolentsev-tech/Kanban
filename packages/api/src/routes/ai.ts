import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ClaudeService } from '../services/claude.service';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';

export const aiRouter = Router();
const claude = new ClaudeService();

const ChatSchema = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })),
  context: z.string().optional(),
});

aiRouter.post('/chat', async (req: Request, res: Response) => {
  const parsed = ChatSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  try {
    const reply = await claude.chat(parsed.data.messages, parsed.data.context);
    res.json(ok({ reply }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'AI error'));
  }
});

aiRouter.post('/daily-brief', async (_req: Request, res: Response) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const tasks = getDb().prepare("SELECT title, status, priority, urgency, due_date FROM tasks WHERE archived = 0 AND status != 'done' ORDER BY priority DESC LIMIT 20").all();
    const meetings = getDb().prepare('SELECT title, date FROM meetings WHERE date >= ? ORDER BY date ASC LIMIT 10').all(today);
    const brief = await claude.dailyBrief(JSON.stringify(tasks), JSON.stringify(meetings));
    res.json(ok({ brief }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'AI error'));
  }
});

aiRouter.get('/search', async (req: Request, res: Response) => {
  const q = req.query['q'];
  if (typeof q !== 'string' || !q) { res.status(400).json(fail('Query parameter q is required')); return; }
  try {
    const tasks = getDb().prepare("SELECT title FROM tasks WHERE title LIKE ? LIMIT 10").all(`%${q}%`);
    const meetings = getDb().prepare("SELECT title, summary_raw FROM meetings WHERE title LIKE ? OR summary_raw LIKE ? LIMIT 5").all(`%${q}%`, `%${q}%`);
    const result = await claude.searchKnowledge(q, JSON.stringify({ tasks, meetings }));
    res.json(ok(result));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Search error'));
  }
});
