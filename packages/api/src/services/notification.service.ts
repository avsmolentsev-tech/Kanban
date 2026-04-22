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

interface UserCtx {
  id: number;
  tg_id: string;
  name: string;
}

function getUsers(): UserCtx[] {
  return telegramService.getLinkedUsers();
}

export function startNotificationScheduler(): void {
  setInterval(() => {
    checkOverdueTasks();
    checkMorningBrief();
    checkUpcomingMeetings();
    checkWeeklyReport();
    checkDailyDigest();
    checkHabitReminders();
    checkUpcomingDeadlines();
    checkWeeklyGoalPrompt();
    checkDailyGoalReminder();
    checkBhagCoach();
  }, 15 * 60 * 1000);

  setTimeout(checkOverdueTasks, 10000);
  console.log('[notifications] scheduler started');
}

function checkOverdueTasks(): void {
  const today = moscowDateString();
  const db = getDb();

  for (const user of getUsers()) {
    const overdue = db.prepare(
      "SELECT title, due_date, priority FROM tasks WHERE archived = 0 AND status NOT IN ('done', 'someday') AND due_date < ? AND user_id = ? ORDER BY due_date ASC LIMIT 10"
    ).all(today, user.id) as Array<{ title: string; due_date: string; priority: number }>;

    if (overdue.length === 0) continue;
    // Send overdue digest at most once per day per user
    if (!shouldSendNotification(user.id, 'overdue_digest', 'all')) continue;

    const lines = overdue.map(t => `⚠️ <b>${t.title}</b> (срок: ${t.due_date})`);
    telegramService.notifyUser(user.tg_id, `🔔 Просроченные задачи (${overdue.length}):\n\n${lines.join('\n')}`);
  }
}

function checkMorningBrief(): void {
  const now = moscowNow();
  const hour = now.getUTCHours();
  const today = moscowDateString();
  if (hour !== 9) return;
  if (lastMorningBrief === today) return;
  lastMorningBrief = today;

  const db = getDb();

  for (const user of getUsers()) {
    const tasks = db.prepare("SELECT title, priority FROM tasks WHERE archived = 0 AND status = 'in_progress' AND user_id = ? ORDER BY priority DESC LIMIT 5").all(user.id) as Array<{ title: string; priority: number }>;
    const todayTasks = db.prepare("SELECT title FROM tasks WHERE archived = 0 AND due_date = ? AND status != 'done' AND user_id = ?").all(today, user.id) as Array<{ title: string }>;
    const todayMeetings = db.prepare("SELECT title, date FROM meetings WHERE date = ? AND user_id = ? AND (summary_raw IS NULL OR summary_raw = '') AND (source_file IS NULL OR source_file = '') ORDER BY date").all(today, user.id) as Array<{ title: string; date: string }>;

    let msg = `🌅 <b>Доброе утро, ${user.name}!</b>\n\n`;
    if (todayMeetings.length > 0) {
      msg += `📅 Встречи сегодня (${todayMeetings.length}):\n${todayMeetings.map(m => `  • ${m.title}`).join('\n')}\n\n`;
    }
    if (todayTasks.length > 0) {
      msg += `📋 Задачи на сегодня (${todayTasks.length}):\n${todayTasks.map(t => `  • ${t.title}`).join('\n')}\n\n`;
    }
    if (tasks.length > 0) {
      msg += `🔄 В работе:\n${tasks.map(t => `  • ${t.title} ${'⭐'.repeat(t.priority)}`).join('\n')}`;
    }

    // Focus of the day
    const journal = db.prepare('SELECT focus FROM journal WHERE date = ? AND user_id = ?').get(today, user.id) as { focus: string } | undefined;
    const focusLine = journal?.focus ? `\n🎯 <b>Фокус дня:</b> ${journal.focus}` : '\n🎯 Фокус дня не задан. Напиши /focus чтобы поставить.';
    msg += focusLine;

    if (todayMeetings.length > 0 || todayTasks.length > 0 || tasks.length > 0 || focusLine) {
      telegramService.notifyUser(user.tg_id, msg);
    }
  }
}

function checkWeeklyReport(): void {
  const now = moscowNow();
  const hour = now.getUTCHours();
  const dayOfWeek = now.getUTCDay();
  const today = moscowDateString();

  if (dayOfWeek !== 1 || hour !== 10) return;
  if (lastWeeklyReport === today) return;
  lastWeeklyReport = today;

  const db = getDb();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  for (const user of getUsers()) {
    try {
      const completed = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'done' AND updated_at >= ? AND user_id = ?").get(weekAgo, user.id) as { c: number }).c;
      const created = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE created_at >= ? AND user_id = ?").get(weekAgo, user.id) as { c: number }).c;
      const meetingsCount = (db.prepare("SELECT COUNT(*) as c FROM meetings WHERE date >= ? AND date <= ? AND user_id = ?").get(weekAgo, today, user.id) as { c: number }).c;
      const active = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE archived = 0 AND status NOT IN ('done','someday') AND user_id = ?").get(user.id) as { c: number }).c;

      let msg = `📊 <b>Еженедельный отчёт</b>\n\n`;
      msg += `📅 Неделя: ${weekAgo} — ${today}\n\n`;
      msg += `✅ Завершено задач: ${completed}\n`;
      msg += `➕ Создано задач: ${created}\n`;
      msg += `🤝 Встреч: ${meetingsCount}\n`;
      msg += `📋 Активных задач: ${active}\n`;

      telegramService.notifyUser(user.tg_id, msg);

      // Generate and send PDF bundle for admin users
      if (user.id === getUsers()[0]?.id) {
        try {
          const result = generateBundle('all', true);
          const fullPath = path.join(config.vaultPath, result.vaultPath);
          const formats = generateAllFormats(fullPath);
          if (formats.pdf) {
            telegramService.sendFileToUser(user.tg_id, formats.pdf, `weekly-${today}.pdf`, '📦 Еженедельный bundle');
          }
        } catch {}
      }
    } catch (err) {
      console.warn(`[notifications] weekly report failed for user ${user.id}:`, err);
    }
  }
}

function checkDailyDigest(): void {
  const now = moscowNow();
  const hour = now.getUTCHours();
  const today = moscowDateString();
  if (hour !== 21) return;
  if (lastDailyDigest === today) return;
  lastDailyDigest = today;

  const db = getDb();

  for (const user of getUsers()) {
    try {
      const done = db.prepare("SELECT title FROM tasks WHERE status = 'done' AND updated_at LIKE ? AND archived = 0 AND user_id = ?").all(`${today}%`, user.id) as Array<{ title: string }>;
      const inProgress = db.prepare("SELECT title, priority FROM tasks WHERE status = 'in_progress' AND archived = 0 AND user_id = ? ORDER BY priority DESC LIMIT 5").all(user.id) as Array<{ title: string; priority: number }>;
      const overdue = db.prepare("SELECT title, due_date FROM tasks WHERE archived = 0 AND status NOT IN ('done','someday') AND due_date < ? AND user_id = ? LIMIT 5").all(today, user.id) as Array<{ title: string; due_date: string }>;
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]!;
      const tomorrowTasks = db.prepare("SELECT title FROM tasks WHERE due_date = ? AND archived = 0 AND status != 'done' AND user_id = ?").all(tomorrow, user.id) as Array<{ title: string }>;
      const tomorrowMeetings = db.prepare("SELECT title FROM meetings WHERE date = ? AND user_id = ?").all(tomorrow, user.id) as Array<{ title: string }>;

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

      telegramService.notifyUser(user.tg_id, msg);
    } catch (err) {
      console.warn(`[notifications] daily digest failed for user ${user.id}:`, err);
    }
  }
}

function checkHabitReminders(): void {
  try {
    const now = moscowNow();
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();
    const today = moscowDateString();
    const currentTime = `${String(hour).padStart(2, '0')}:${String(minute < 30 ? '00' : '30')}`;

    const db = getDb();

    for (const user of getUsers()) {
      const habits = db.prepare("SELECT id, title, icon, remind_time FROM habits WHERE archived = 0 AND remind_time IS NOT NULL AND user_id = ?").all(user.id) as Array<{ id: number; title: string; icon: string; remind_time: string }>;

      for (const h of habits) {
        if (h.remind_time !== currentTime) continue;
        const log = db.prepare("SELECT id FROM habit_logs WHERE habit_id = ? AND date = ?").get(h.id, today);
        if (log) continue;
        telegramService.notifyUser(user.tg_id, `${h.icon} Напоминание: <b>${h.title}</b>\n\nОтметь в /habits или в приложении`);
      }
    }
  } catch {}
}

function checkUpcomingDeadlines(): void {
  const now = moscowNow();
  const hour = now.getUTCHours();
  const today = moscowDateString();
  if (hour !== 20) return;
  if (lastDeadlineCheck === today) return;
  lastDeadlineCheck = today;

  const db = getDb();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStr = tomorrow.toISOString().split('T')[0]!;

  for (const user of getUsers()) {
    try {
      const tasks = db.prepare(
        "SELECT title FROM tasks WHERE archived = 0 AND status NOT IN ('done', 'someday') AND due_date = ? AND user_id = ? ORDER BY priority DESC"
      ).all(tomorrowStr, user.id) as Array<{ title: string }>;

      if (tasks.length === 0) continue;

      const lines = tasks.map(t => `• ${t.title}`);
      if (!shouldSendNotification(user.id, 'deadline_tomorrow', 'all')) continue;
      telegramService.notifyUser(user.tg_id, `⏰ Завтра дедлайн:\n\n${lines.join('\n')}`);
    } catch {}
  }
}

/**
 * Persistent dedup: try to register a notification. Returns true if it's a NEW one
 * and the caller should send. False if already sent today for this (user, type, ref).
 */
function shouldSendNotification(userId: number, type: string, refId: string): boolean {
  const db = getDb();
  // ref_id includes the date so the same meeting/task can be re-notified next day
  const key = `${refId}|${moscowDateString()}`;
  try {
    const result = db.prepare('INSERT OR IGNORE INTO notification_log (user_id, type, ref_id) VALUES (?, ?, ?)').run(userId, type, key);
    return result.changes > 0;
  } catch {
    return true; // on DB error, prefer to send rather than miss
  }
}

function checkUpcomingMeetings(): void {
  const today = moscowDateString();
  const db = getDb();

  for (const user of getUsers()) {
    // Only remind about PLANNED meetings — skip those already transcribed/summarized
    const meetings = db.prepare(
      "SELECT id, title FROM meetings WHERE date = ? AND user_id = ? AND (summary_raw IS NULL OR summary_raw = '') AND (source_file IS NULL OR source_file = '') ORDER BY id"
    ).all(today, user.id) as Array<{ id: number; title: string }>;

    if (meetings.length === 0) continue;
    if (!shouldSendNotification(user.id, 'meetings_today_digest', 'all')) continue;

    const lines = meetings.map(m => `  • ${m.title}`);
    const header = meetings.length === 1 ? '📅 Встреча сегодня:' : `📅 Встречи сегодня (${meetings.length}):`;
    telegramService.notifyUser(user.tg_id, `${header}\n${lines.join('\n')}`);
  }
}

function getNextMonday(today: string): string {
  const d = new Date(today + 'T00:00:00Z');
  const day = d.getUTCDay();
  const diff = day === 0 ? 1 : (8 - day); // if Sunday, next Monday is +1; else next Monday
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().split('T')[0]!;
}

function checkWeeklyGoalPrompt(): void {
  const now = moscowNow();
  const hour = now.getUTCHours();
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon
  const today = moscowDateString();
  const db = getDb();

  // Sunday 18:00 MSK or Monday 09:00 MSK
  const isSundayEvening = dayOfWeek === 0 && hour >= 18 && hour < 19;
  const isMondayMorning = dayOfWeek === 1 && hour >= 9 && hour < 10;

  if (!isSundayEvening && !isMondayMorning) return;

  for (const user of getUsers()) {
    const notifKey = isSundayEvening ? 'weekly_goal_sunday' : 'weekly_goal_monday';
    if (!shouldSendNotification(user.id, notifKey, 'all')) continue;

    // Check if user already has weekly-goal tasks for next week
    const nextMonday = isSundayEvening ? getNextMonday(today) : today; // Monday morning = this week
    const nextSundayDate = (() => {
      const d = new Date(nextMonday + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + 6);
      return d.toISOString().split('T')[0]!;
    })();
    const existing = db.prepare(
      "SELECT COUNT(*) as c FROM tasks WHERE user_id = ? AND description LIKE '%[🎯 Цель недели]%' AND due_date >= ? AND due_date <= ? AND archived = 0"
    ).get(user.id, nextMonday, nextSundayDate) as { c: number };

    if (existing.c > 0) continue; // already set

    const message = isSundayEvening
      ? '🎯 Какие цели на следующую неделю? Напиши или надиктуй список — я распределю по дням.'
      : '🌅 Неделя началась! Расставим цели? Напиши что планируешь на эту неделю.';

    telegramService.notifyUser(user.tg_id, message);
  }
}

function checkDailyGoalReminder(): void {
  const now = moscowNow();
  const today = moscowDateString();
  const db = getDb();

  for (const user of getUsers()) {
    // Get user's reminder time (default 21:00)
    const timeSetting = db.prepare('SELECT value FROM settings WHERE user_id = ? AND key = ?').get(user.id, 'reminder_time') as { value: string } | undefined;
    const reminderTime = timeSetting?.value ?? '21:00';
    const [rHourStr, rMinStr] = reminderTime.split(':');
    const rHour = Number(rHourStr);
    const rMin = Number(rMinStr ?? 0);

    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();

    // Check if current time is within the reminder window (±7 min since scheduler runs every 15 min)
    if (hour !== rHour || minute < rMin - 7 || minute > rMin + 7) continue;

    if (!shouldSendNotification(user.id, 'daily_goal_reminder', 'all')) continue;

    // Find today's weekly-goal task that's not done
    const goalTask = db.prepare(
      "SELECT title FROM tasks WHERE user_id = ? AND description LIKE '%[🎯 Цель недели]%' AND due_date = ? AND status != 'done' AND archived = 0 LIMIT 1"
    ).get(user.id, today) as { title: string } | undefined;

    if (!goalTask) continue;

    telegramService.notifyUser(user.tg_id, `🎯 Главная цель сегодня: <b>${goalTask.title}</b>\n\nУспел? Отметь задачу как выполненную или перенеси на завтра.`);
  }
}

function checkBhagCoach(): void {
  const now = moscowNow();
  const hour = now.getUTCHours();
  const dayOfWeek = now.getUTCDay(); // 5 = Friday
  const today = moscowDateString();

  if (dayOfWeek !== 5 || hour < 18 || hour >= 19) return;

  const db = getDb();
  for (const user of getUsers()) {
    if (!shouldSendNotification(user.id, 'bhag_coach', today)) continue;

    // Get active BHAGs
    const bhags = db.prepare("SELECT id, title, due_date FROM goals WHERE type = 'bhag' AND status = 'active' AND user_id = ?").all(user.id) as Array<{ id: number; title: string; due_date: string }>;
    if (bhags.length === 0) continue;

    for (const bhag of bhags) {
      // Get milestones with progress
      const milestones = db.prepare("SELECT id, title, due_date FROM goals WHERE parent_id = ? AND user_id = ?").all(bhag.id, user.id) as Array<{ id: number; title: string; due_date: string }>;

      let totalTasks = 0, doneTasks = 0;
      const milestoneStats: string[] = [];

      for (const m of milestones) {
        const tasks = db.prepare("SELECT status FROM tasks WHERE goal_id = ? AND user_id = ? AND archived = 0").all(m.id, user.id) as Array<{ status: string }>;
        const done = tasks.filter(t => t.status === 'done').length;
        totalTasks += tasks.length;
        doneTasks += done;
        const pct = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;
        const emoji = pct === 100 ? '✅' : pct > 0 ? '🟡' : '⚪';
        milestoneStats.push(`${emoji} ${m.title}: ${done}/${tasks.length} (${pct}%)`);
      }

      const overallPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
      const daysLeft = Math.max(0, Math.ceil((new Date(bhag.due_date).getTime() - Date.now()) / 86400000));

      const message = `🎯 <b>BHAG Coach: ${bhag.title}</b>\n\n` +
        `Прогресс: ${overallPct}% (${doneTasks}/${totalTasks} задач)\n` +
        `Осталось дней: ${daysLeft}\n\n` +
        `<b>Milestones:</b>\n${milestoneStats.join('\n')}\n\n` +
        (overallPct < 30 && daysLeft < 180 ? '⚠️ Темп ниже нужного! Стоит пересмотреть план или ускориться.' :
         overallPct > 70 ? '🔥 Отличный прогресс! Финишная прямая.' :
         '💪 Продолжай в том же духе!');

      telegramService.notifyUser(user.tg_id, message);
    }
  }
}
