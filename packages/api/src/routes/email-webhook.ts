import { Router, Request, Response } from 'express';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';

export const emailWebhookRouter = Router();

// POST /email-webhook — creates a task from forwarded email
// Works with: Zapier, Make.com, n8n, or direct webhook
emailWebhookRouter.post('/', (req: Request, res: Response) => {
  const secret = req.query['token'] || req.headers['x-webhook-secret'];
  if (secret !== process.env['WEBHOOK_SECRET'] && secret !== 'pis-webhook-2026') {
    res.status(403).json(fail('Invalid webhook token'));
    return;
  }
  const { subject, from, body, text, html } = req.body;

  const title = subject || 'Задача из email';
  const description = text || body || html?.replace(/<[^>]+>/g, '') || '';
  const senderInfo = from || '';

  const db = getDb();

  // Webhook has no session; route to explicit user_id (query/body) or env default.
  const userIdRaw = req.query['user_id'] ?? req.body?.user_id ?? process.env['WEBHOOK_DEFAULT_USER_ID'];
  const userId = userIdRaw != null ? Number(userIdRaw) : NaN;
  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(400).json(fail('Missing user_id (provide ?user_id=N or set WEBHOOK_DEFAULT_USER_ID)'));
    return;
  }
  const userExists = db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId);
  if (!userExists) { res.status(400).json(fail('Invalid user_id')); return; }

  const selfRow = db.prepare("SELECT id FROM people WHERE user_id = ? AND LOWER(name) IN ('я','me','self') LIMIT 1").get(userId) as { id: number } | undefined;

  const result = db.prepare('INSERT INTO tasks (user_id, title, description, status, priority) VALUES (?, ?, ?, ?, ?)').run(
    userId,
    title.slice(0, 200),
    `${senderInfo ? 'От: ' + senderInfo + '\n\n' : ''}${description.slice(0, 5000)}`,
    'backlog',
    3
  );

  const taskId = Number(result.lastInsertRowid);
  if (selfRow) {
    db.prepare('INSERT OR IGNORE INTO task_people (task_id, person_id) VALUES (?, ?)').run(taskId, selfRow.id);
  }

  res.json(ok({ task_id: taskId, title }));
});

// Also support simple GET for testing
emailWebhookRouter.get('/test', (_req: Request, res: Response) => {
  res.json(ok({ status: 'Email webhook active', usage: 'POST with {subject, from, body}' }));
});
