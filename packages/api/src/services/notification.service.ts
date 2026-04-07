import { getDb } from '../db/db';
import { telegramService } from './telegram.service';

export function startNotificationScheduler(): void {
  // Check every hour for overdue tasks
  setInterval(() => {
    checkOverdueTasks();
  }, 60 * 60 * 1000);

  // Also check on startup after 10 seconds
  setTimeout(checkOverdueTasks, 10000);
  console.log('[notifications] scheduler started');
}

function checkOverdueTasks(): void {
  const today = new Date().toISOString().split('T')[0];
  const db = getDb();

  const overdue = db.prepare(
    "SELECT title, due_date, priority FROM tasks WHERE archived = 0 AND status NOT IN ('done', 'someday') AND due_date < ? ORDER BY due_date ASC LIMIT 10"
  ).all(today) as Array<{ title: string; due_date: string; priority: number }>;

  if (overdue.length === 0) return;

  const lines = overdue.map(t => `⚠️ <b>${t.title}</b> (срок: ${t.due_date})`);
  const message = `🔔 Просроченные задачи (${overdue.length}):\n\n${lines.join('\n')}`;

  telegramService.notify(message);
}
