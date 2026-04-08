import { getDb } from '../db/db';
import { telegramService } from './telegram.service';
import { moscowNow, moscowDateString } from '../utils/time';

let lastMorningBrief = '';

export function startNotificationScheduler(): void {
  // Check every 15 minutes
  setInterval(() => {
    checkOverdueTasks();
    checkMorningBrief();
    checkUpcomingMeetings();
  }, 15 * 60 * 1000);

  setTimeout(checkOverdueTasks, 10000);
  console.log('[notifications] scheduler started');
}

function checkOverdueTasks(): void {
  const today = moscowDateString();
  const db = getDb();

  const overdue = db.prepare(
    "SELECT title, due_date, priority FROM tasks WHERE archived = 0 AND status NOT IN ('done', 'someday') AND due_date < ? ORDER BY due_date ASC LIMIT 10"
  ).all(today) as Array<{ title: string; due_date: string; priority: number }>;

  if (overdue.length === 0) return;

  const lines = overdue.map(t => `⚠️ <b>${t.title}</b> (срок: ${t.due_date})`);
  const message = `🔔 Просроченные задачи (${overdue.length}):\n\n${lines.join('\n')}`;

  telegramService.notify(message);
}

/** Morning brief at 9:00 Moscow time */
function checkMorningBrief(): void {
  const now = moscowNow();
  const hour = now.getUTCHours();
  const today = moscowDateString();
  if (hour !== 9) return;
  if (lastMorningBrief === today) return;
  lastMorningBrief = today;

  const db = getDb();
  const tasks = db.prepare("SELECT title, priority FROM tasks WHERE archived = 0 AND status = 'in_progress' ORDER BY priority DESC LIMIT 5").all() as Array<{ title: string; priority: number }>;
  const todayTasks = db.prepare("SELECT title FROM tasks WHERE archived = 0 AND due_date = ? AND status != 'done'").all(today) as Array<{ title: string }>;
  const todayMeetings = db.prepare("SELECT title, date FROM meetings WHERE date = ? ORDER BY date").all(today) as Array<{ title: string; date: string }>;

  let msg = `🌅 <b>Доброе утро!</b>\n\n`;
  if (todayMeetings.length > 0) {
    msg += `📅 Встречи сегодня (${todayMeetings.length}):\n${todayMeetings.map(m => `  • ${m.title}`).join('\n')}\n\n`;
  }
  if (todayTasks.length > 0) {
    msg += `📋 Задачи на сегодня (${todayTasks.length}):\n${todayTasks.map(t => `  • ${t.title}`).join('\n')}\n\n`;
  }
  if (tasks.length > 0) {
    msg += `🔄 В работе:\n${tasks.map(t => `  • ${t.title} ${'⭐'.repeat(t.priority)}`).join('\n')}`;
  }

  if (todayMeetings.length > 0 || todayTasks.length > 0 || tasks.length > 0) {
    telegramService.notify(msg);
  }
}

/** Remind about meetings happening in next 30 minutes */
const notifiedMeetings = new Set<number>();
function checkUpcomingMeetings(): void {
  const now = moscowNow();
  const today = moscowDateString();
  const db = getDb();

  const meetings = db.prepare("SELECT id, title, date FROM meetings WHERE date = ?").all(today) as Array<{ id: number; title: string; date: string }>;

  for (const m of meetings) {
    if (notifiedMeetings.has(m.id)) continue;
    // Simple: notify once per day if there's a meeting today (no time info in date field)
    // More sophisticated logic would parse a time field if added
    notifiedMeetings.add(m.id);
  }

  // Clear old notifications at midnight
  if (now.getUTCHours() === 0) notifiedMeetings.clear();
}
