import { getDb } from '../db/db';
import { telegramService } from './telegram.service';
import { moscowNow, moscowDateString } from '../utils/time';
import { generateBundle } from './bundle.service';
import { generateAllFormats } from './converter.service';
import * as path from 'path';
import { config } from '../config';

let lastMorningBrief = '';
let lastWeeklyReport = '';
let lastDailyDigest = '';
let lastDeadlineCheck = '';

export function startNotificationScheduler(): void {
  // Check every 15 minutes
  setInterval(() => {
    checkOverdueTasks();
    checkMorningBrief();
    checkUpcomingMeetings();
    checkWeeklyReport();
    checkDailyDigest();
    checkHabitReminders();
    checkUpcomingDeadlines();
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

/** Weekly report on Monday at 10:00 Moscow time — sends PDF bundle */
function checkWeeklyReport(): void {
  const now = moscowNow();
  const hour = now.getUTCHours();
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon
  const today = moscowDateString();

  if (dayOfWeek !== 1 || hour !== 10) return; // Monday 10:00 MSK
  if (lastWeeklyReport === today) return;
  lastWeeklyReport = today;

  try {
    const db = getDb();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Stats
    const completed = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'done' AND updated_at >= ?").get(weekAgo) as { c: number };
    const created = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE created_at >= ?").get(weekAgo) as { c: number };
    const meetingsCount = db.prepare("SELECT COUNT(*) as c FROM meetings WHERE date >= ? AND date <= ?").get(weekAgo, today) as { c: number };
    const active = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE archived = 0 AND status NOT IN ('done','someday')").get() as { c: number };

    let msg = `📊 <b>Еженедельный отчёт</b>\n\n`;
    msg += `📅 Неделя: ${weekAgo} — ${today}\n\n`;
    msg += `✅ Завершено задач: ${completed.c}\n`;
    msg += `➕ Создано задач: ${created.c}\n`;
    msg += `🤝 Встреч: ${meetingsCount.c}\n`;
    msg += `📋 Активных задач: ${active.c}\n\n`;

    telegramService.notify(msg);

    // Generate and send PDF bundle
    try {
      const result = generateBundle('all');
      const fullPath = path.join(config.vaultPath, result.vaultPath);
      const formats = generateAllFormats(fullPath);

      if (formats.pdf) {
        telegramService.sendFile(formats.pdf, `weekly-${today}.pdf`, '📦 Еженедельный bundle — загрузи в NotebookLM');
      }
    } catch (err) {
      console.warn('[notifications] weekly bundle failed:', err);
    }
  } catch (err) {
    console.warn('[notifications] weekly report failed:', err);
  }
}

/** Evening daily digest at 21:00 MSK — what was done + what's left */
function checkDailyDigest(): void {
  const now = moscowNow();
  const hour = now.getUTCHours();
  const today = moscowDateString();
  if (hour !== 21) return;
  if (lastDailyDigest === today) return;
  lastDailyDigest = today;

  try {
    const db = getDb();
    const done = db.prepare("SELECT title FROM tasks WHERE status = 'done' AND updated_at LIKE ? AND archived = 0").all(`${today}%`) as Array<{ title: string }>;
    const inProgress = db.prepare("SELECT title, priority FROM tasks WHERE status = 'in_progress' AND archived = 0 ORDER BY priority DESC LIMIT 5").all() as Array<{ title: string; priority: number }>;
    const overdue = db.prepare("SELECT title, due_date FROM tasks WHERE archived = 0 AND status NOT IN ('done','someday') AND due_date < ? LIMIT 5").all(today) as Array<{ title: string; due_date: string }>;
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]!;
    const tomorrowTasks = db.prepare("SELECT title FROM tasks WHERE due_date = ? AND archived = 0 AND status != 'done'").all(tomorrow) as Array<{ title: string }>;
    const tomorrowMeetings = db.prepare("SELECT title FROM meetings WHERE date = ?").all(tomorrow) as Array<{ title: string }>;

    let msg = `🌙 <b>Итоги дня</b>\n\n`;

    if (done.length > 0) {
      msg += `✅ Сделано сегодня (${done.length}):\n${done.map(t => `  • ${t.title}`).join('\n')}\n\n`;
    } else {
      msg += `📋 Задач завершено: 0\n\n`;
    }

    if (inProgress.length > 0) {
      msg += `🔄 В работе:\n${inProgress.map(t => `  • ${t.title} ${'⭐'.repeat(t.priority)}`).join('\n')}\n\n`;
    }

    if (overdue.length > 0) {
      msg += `⚠️ Просрочено:\n${overdue.map(t => `  • ${t.title} (${t.due_date})`).join('\n')}\n\n`;
    }

    if (tomorrowTasks.length > 0 || tomorrowMeetings.length > 0) {
      msg += `📅 Завтра:\n`;
      for (const m of tomorrowMeetings) msg += `  🤝 ${m.title}\n`;
      for (const t of tomorrowTasks) msg += `  📋 ${t.title}\n`;
    }

    telegramService.notify(msg);
  } catch (err) {
    console.warn('[notifications] daily digest failed:', err);
  }
}

/** Habit reminders based on remind_time */
function checkHabitReminders(): void {
  try {
    const now = moscowNow();
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();
    const today = moscowDateString();
    const currentTime = `${String(hour).padStart(2, '0')}:${String(minute < 30 ? '00' : '30')}`;

    const db = getDb();
    const habits = db.prepare("SELECT id, title, icon, remind_time FROM habits WHERE archived = 0 AND remind_time IS NOT NULL").all() as Array<{ id: number; title: string; icon: string; remind_time: string }>;

    for (const h of habits) {
      if (h.remind_time !== currentTime) continue;
      // Check if already done today
      const log = db.prepare("SELECT id FROM habit_logs WHERE habit_id = ? AND date = ?").get(h.id, today);
      if (log) continue;
      telegramService.notify(`${h.icon} Напоминание: <b>${h.title}</b>\n\nОтметь в /habits или в приложении`);
    }
  } catch {}
}

/** Deadline reminder — notify about tasks due tomorrow (at 20:00 MSK) */
function checkUpcomingDeadlines(): void {
  const now = moscowNow();
  const hour = now.getUTCHours();
  const today = moscowDateString();
  if (hour !== 20) return;
  if (lastDeadlineCheck === today) return;
  lastDeadlineCheck = today;

  try {
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowStr = tomorrow.toISOString().split('T')[0]!;
    const db = getDb();
    const tasks = db.prepare(
      "SELECT title FROM tasks WHERE archived = 0 AND status NOT IN ('done', 'someday') AND due_date = ? ORDER BY priority DESC"
    ).all(tomorrowStr) as Array<{ title: string }>;

    if (tasks.length === 0) return;

    const lines = tasks.map(t => `• ${t.title}`);
    const message = `⏰ Завтра дедлайн:\n\n${lines.join('\n')}`;
    telegramService.notify(message);
  } catch (err) {
    console.warn('[notifications] deadline check failed:', err);
  }
}

/** Remind about meetings today (once per meeting) */
const notifiedMeetings = new Set<number>();
function checkUpcomingMeetings(): void {
  const now = moscowNow();
  const today = moscowDateString();
  const db = getDb();

  const meetings = db.prepare("SELECT id, title, date FROM meetings WHERE date = ?").all(today) as Array<{ id: number; title: string; date: string }>;

  for (const m of meetings) {
    if (notifiedMeetings.has(m.id)) continue;
    notifiedMeetings.add(m.id);
    telegramService.notify(`📅 Встреча сегодня: <b>${m.title}</b>`);
  }

  // Clear at midnight
  if (now.getUTCHours() === 0) notifiedMeetings.clear();
}
