import { queryAll, queryOne, execute } from '../db/db';
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

async function getUsers(): Promise<UserCtx[]> {
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

async function checkOverdueTasks(): Promise<void> {
  const now = moscowNow();
  const hour = now.getUTCHours();
  // Don't send overdue notifications at night (22:00–08:00)
  if (hour >= 22 || hour < 8) return;

  const today = moscowDateString();

  for (const user of await getUsers()) {
    const overdue = await queryAll<{ title: string; due_date: string; priority: number }>(
      "SELECT title, due_date, priority FROM tasks WHERE archived = 0 AND status NOT IN ('done', 'someday') AND due_date < $1 AND user_id = $2 ORDER BY due_date ASC LIMIT 10",
      [today, user.id]
    );

    if (overdue.length === 0) continue;
    // Send overdue digest at most once per day per user
    if (!await shouldSendNotification(user.id, 'overdue_digest', 'all')) continue;

    // Start with achievements, then overdue
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const doneWeekRow = await queryOne<{ c: number }>(
      "SELECT COUNT(*) as c FROM tasks WHERE status = 'done' AND archived = 0 AND updated_at >= $1 AND user_id = $2",
      [sevenDaysAgo, user.id]
    );
    const doneWeek = doneWeekRow?.c ?? 0;

    const inProgressRow = await queryOne<{ c: number }>(
      "SELECT COUNT(*) as c FROM tasks WHERE status = 'in_progress' AND archived = 0 AND user_id = $1",
      [user.id]
    );
    const inProgress = inProgressRow?.c ?? 0;

    let msg = '';
    // Positive opening
    if (doneWeek > 0) {
      msg += `💪 За неделю закрыто ${doneWeek} задач — отличный темп!\n\n`;
    } else if (inProgress > 0) {
      msg += `🚀 У тебя ${inProgress} задач в работе — двигаешься!\n\n`;
    }

    // Then overdue — soft tone
    msg += `📋 Есть ${overdue.length} задач с прошедшим сроком — может перенесём или закроем?\n\n`;
    const lines = overdue.map(t => `  • ${t.title} (${t.due_date})`);
    msg += lines.join('\n');

    telegramService.notifyUser(user.tg_id, msg);
  }
}

async function checkMorningBrief(): Promise<void> {
  const now = moscowNow();
  const hour = now.getUTCHours();
  const today = moscowDateString();
  if (hour !== 9) return;
  if (lastMorningBrief === today) return;
  lastMorningBrief = today;

  for (const user of await getUsers()) {
    const tasks = await queryAll<{ title: string; priority: number }>(
      "SELECT title, priority FROM tasks WHERE archived = 0 AND status = 'in_progress' AND user_id = $1 ORDER BY priority DESC LIMIT 5",
      [user.id]
    );
    const todayTasks = await queryAll<{ title: string }>(
      "SELECT title FROM tasks WHERE archived = 0 AND due_date = $1 AND status != 'done' AND user_id = $2",
      [today, user.id]
    );
    const todayMeetings = await queryAll<{ title: string; date: string }>(
      "SELECT title, date FROM meetings WHERE date = $1 AND user_id = $2 AND (summary_raw IS NULL OR summary_raw = '') AND (source_file IS NULL OR source_file = '') ORDER BY date",
      [today, user.id]
    );

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
    const journal = await queryOne<{ focus: string }>(
      'SELECT focus FROM journal WHERE date = $1 AND user_id = $2',
      [today, user.id]
    );
    const focusLine = journal?.focus ? `\n🎯 <b>Фокус дня:</b> ${journal.focus}` : '\n🎯 Фокус дня не задан. Напиши /focus чтобы поставить.';
    msg += focusLine;

    if (todayMeetings.length > 0 || todayTasks.length > 0 || tasks.length > 0 || focusLine) {
      telegramService.notifyUser(user.tg_id, msg);
    }
  }
}

async function checkWeeklyReport(): Promise<void> {
  const now = moscowNow();
  const hour = now.getUTCHours();
  const dayOfWeek = now.getUTCDay();
  const today = moscowDateString();

  if (dayOfWeek !== 1 || hour !== 10) return;
  if (lastWeeklyReport === today) return;
  lastWeeklyReport = today;

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  for (const user of await getUsers()) {
    try {
      const completedRow = await queryOne<{ c: number }>(
        "SELECT COUNT(*) as c FROM tasks WHERE status = 'done' AND updated_at >= $1 AND user_id = $2",
        [weekAgo, user.id]
      );
      const completed = completedRow?.c ?? 0;

      const createdRow = await queryOne<{ c: number }>(
        "SELECT COUNT(*) as c FROM tasks WHERE created_at >= $1 AND user_id = $2",
        [weekAgo, user.id]
      );
      const created = createdRow?.c ?? 0;

      const meetingsCountRow = await queryOne<{ c: number }>(
        "SELECT COUNT(*) as c FROM meetings WHERE date >= $1 AND date <= $2 AND user_id = $3",
        [weekAgo, today, user.id]
      );
      const meetingsCount = meetingsCountRow?.c ?? 0;

      const activeRow = await queryOne<{ c: number }>(
        "SELECT COUNT(*) as c FROM tasks WHERE archived = 0 AND status NOT IN ('done','someday') AND user_id = $1",
        [user.id]
      );
      const active = activeRow?.c ?? 0;

      let msg = `📊 <b>Еженедельный отчёт</b>\n\n`;
      msg += `📅 Неделя: ${weekAgo} — ${today}\n\n`;
      msg += `✅ Завершено задач: ${completed}\n`;
      msg += `➕ Создано задач: ${created}\n`;
      msg += `🤝 Встреч: ${meetingsCount}\n`;
      msg += `📋 Активных задач: ${active}\n`;

      telegramService.notifyUser(user.tg_id, msg);

      // Generate and send PDF bundle for admin users
      const allUsers = await getUsers();
      if (user.id === allUsers[0]?.id) {
        try {
          const result = await generateBundle('all', true);
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

async function checkDailyDigest(): Promise<void> {
  const now = moscowNow();
  const hour = now.getUTCHours();
  const today = moscowDateString();
  if (hour !== 21) return;
  if (lastDailyDigest === today) return;
  lastDailyDigest = today;

  for (const user of await getUsers()) {
    try {
      const done = await queryAll<{ title: string }>(
        "SELECT title FROM tasks WHERE status = 'done' AND updated_at::text LIKE $1 AND archived = 0 AND user_id = $2",
        [`${today}%`, user.id]
      );
      const inProgress = await queryAll<{ title: string; priority: number }>(
        "SELECT title, priority FROM tasks WHERE status = 'in_progress' AND archived = 0 AND user_id = $1 ORDER BY priority DESC LIMIT 5",
        [user.id]
      );
      const overdue = await queryAll<{ title: string; due_date: string }>(
        "SELECT title, due_date FROM tasks WHERE archived = 0 AND status NOT IN ('done','someday') AND due_date < $1 AND user_id = $2 LIMIT 5",
        [today, user.id]
      );
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]!;
      const tomorrowTasks = await queryAll<{ title: string }>(
        "SELECT title FROM tasks WHERE due_date = $1 AND archived = 0 AND status != 'done' AND user_id = $2",
        [tomorrow, user.id]
      );
      const tomorrowMeetings = await queryAll<{ title: string }>(
        "SELECT title FROM meetings WHERE date = $1 AND user_id = $2",
        [tomorrow, user.id]
      );

      // Habit streaks for motivation
      const habitsDone = await queryAll<{ title: string; icon: string }>(
        `SELECT h.title, h.icon FROM habits h WHERE h.archived = 0 AND h.user_id = $1 AND h.id IN (SELECT habit_id FROM habit_logs WHERE date = $2 AND completed = 1)`,
        [user.id, today]
      );

      let msg = `🌙 <b>Итоги дня</b>\n\n`;

      // Always start positive
      if (done.length > 0) {
        msg += `🎉 Отлично! Сегодня закрыто ${done.length} задач:\n${done.map(t => `  ✅ ${t.title}`).join('\n')}\n\n`;
      }
      if (habitsDone.length > 0) {
        msg += `🔥 Привычки: ${habitsDone.map(h => `${h.icon || '✓'} ${h.title}`).join(', ')}\n\n`;
      }
      if (done.length === 0 && habitsDone.length === 0) {
        msg += `💡 Сегодня был день для планирования — это тоже важно!\n\n`;
      }

      if (inProgress.length > 0) {
        msg += `🔄 В работе:\n${inProgress.map(t => `  • ${t.title} ${'⭐'.repeat(t.priority)}`).join('\n')}\n\n`;
      }
      if (overdue.length > 0) {
        msg += `📋 Есть ${overdue.length} задач с прошедшим сроком — перенесём завтра?\n${overdue.slice(0, 3).map(t => `  • ${t.title}`).join('\n')}\n\n`;
      }
      if (tomorrowTasks.length > 0 || tomorrowMeetings.length > 0) {
        msg += `📅 Завтра:\n`;
        for (const m of tomorrowMeetings) msg += `  🤝 ${m.title}\n`;
        for (const t of tomorrowTasks) msg += `  📋 ${t.title}\n`;
        msg += '\n';
      }
      msg += '🌟 Хорошего вечера!';

      telegramService.notifyUser(user.tg_id, msg);
    } catch (err) {
      console.warn(`[notifications] daily digest failed for user ${user.id}:`, err);
    }
  }
}

async function checkHabitReminders(): Promise<void> {
  try {
    const now = moscowNow();
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();
    const today = moscowDateString();
    const currentTime = `${String(hour).padStart(2, '0')}:${String(minute < 30 ? '00' : '30')}`;

    for (const user of await getUsers()) {
      const habits = await queryAll<{ id: number; title: string; icon: string; remind_time: string }>(
        "SELECT id, title, icon, remind_time FROM habits WHERE archived = 0 AND remind_time IS NOT NULL AND user_id = $1",
        [user.id]
      );

      for (const h of habits) {
        if (h.remind_time !== currentTime) continue;
        const log = await queryOne(
          "SELECT id FROM habit_logs WHERE habit_id = $1 AND date = $2",
          [h.id, today]
        );
        if (log) continue;
        telegramService.notifyUser(user.tg_id, `${h.icon} Напоминание: <b>${h.title}</b>\n\nОтметь в /habits или в приложении`);
      }
    }
  } catch {}
}

async function checkUpcomingDeadlines(): Promise<void> {
  const now = moscowNow();
  const hour = now.getUTCHours();
  const today = moscowDateString();
  if (hour !== 20) return;
  if (lastDeadlineCheck === today) return;
  lastDeadlineCheck = today;

  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStr = tomorrow.toISOString().split('T')[0]!;

  for (const user of await getUsers()) {
    try {
      const tasks = await queryAll<{ title: string }>(
        "SELECT title FROM tasks WHERE archived = 0 AND status NOT IN ('done', 'someday') AND due_date = $1 AND user_id = $2 ORDER BY priority DESC",
        [tomorrowStr, user.id]
      );

      if (tasks.length === 0) continue;

      const lines = tasks.map(t => `• ${t.title}`);
      if (!await shouldSendNotification(user.id, 'deadline_tomorrow', 'all')) continue;
      telegramService.notifyUser(user.tg_id, `⏰ Завтра дедлайн:\n\n${lines.join('\n')}`);
    } catch {}
  }
}

/**
 * Persistent dedup: try to register a notification. Returns true if it's a NEW one
 * and the caller should send. False if already sent today for this (user, type, ref).
 */
async function shouldSendNotification(userId: number, type: string, refId: string): Promise<boolean> {
  // ref_id includes the date so the same meeting/task can be re-notified next day
  const key = `${refId}|${moscowDateString()}`;
  try {
    const rowCount = await execute(
      'INSERT INTO notification_log (user_id, type, ref_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [userId, type, key]
    );
    return rowCount > 0;
  } catch {
    return true; // on DB error, prefer to send rather than miss
  }
}

async function checkUpcomingMeetings(): Promise<void> {
  const today = moscowDateString();

  for (const user of await getUsers()) {
    // Only remind about PLANNED meetings — skip those already transcribed/summarized
    const meetings = await queryAll<{ id: number; title: string }>(
      "SELECT id, title FROM meetings WHERE date = $1 AND user_id = $2 AND (summary_raw IS NULL OR summary_raw = '') AND (source_file IS NULL OR source_file = '') ORDER BY id",
      [today, user.id]
    );

    if (meetings.length === 0) continue;
    if (!await shouldSendNotification(user.id, 'meetings_today_digest', 'all')) continue;

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

async function checkWeeklyGoalPrompt(): Promise<void> {
  const now = moscowNow();
  const hour = now.getUTCHours();
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon
  const today = moscowDateString();

  // Sunday 18:00 MSK or Monday 09:00 MSK
  const isSundayEvening = dayOfWeek === 0 && hour >= 18 && hour < 19;
  const isMondayMorning = dayOfWeek === 1 && hour >= 9 && hour < 10;

  if (!isSundayEvening && !isMondayMorning) return;

  for (const user of await getUsers()) {
    const notifKey = isSundayEvening ? 'weekly_goal_sunday' : 'weekly_goal_monday';
    if (!await shouldSendNotification(user.id, notifKey, 'all')) continue;

    // Check if user already has weekly-goal tasks for next week
    const nextMonday = isSundayEvening ? getNextMonday(today) : today; // Monday morning = this week
    const nextSundayDate = (() => {
      const d = new Date(nextMonday + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + 6);
      return d.toISOString().split('T')[0]!;
    })();
    const existing = await queryOne<{ c: number }>(
      "SELECT COUNT(*) as c FROM tasks WHERE user_id = $1 AND description LIKE $2 AND due_date >= $3 AND due_date <= $4 AND archived = 0",
      [user.id, '%[🎯 Цель недели]%', nextMonday, nextSundayDate]
    );

    if ((existing?.c ?? 0) > 0) continue; // already set

    const message = isSundayEvening
      ? '🎯 Какие цели на следующую неделю? Напиши или надиктуй список — я распределю по дням.'
      : '🌅 Неделя началась! Расставим цели? Напиши что планируешь на эту неделю.';

    telegramService.notifyUser(user.tg_id, message);
  }
}

async function checkDailyGoalReminder(): Promise<void> {
  const now = moscowNow();
  const today = moscowDateString();

  for (const user of await getUsers()) {
    // Get user's reminder time (default 21:00)
    const timeSetting = await queryOne<{ value: string }>(
      'SELECT value FROM settings WHERE user_id = $1 AND key = $2',
      [user.id, 'reminder_time']
    );
    const reminderTime = timeSetting?.value ?? '21:00';
    const [rHourStr, rMinStr] = reminderTime.split(':');
    const rHour = Number(rHourStr);
    const rMin = Number(rMinStr ?? 0);

    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();

    // Check if current time is within the reminder window (±7 min since scheduler runs every 15 min)
    if (hour !== rHour || minute < rMin - 7 || minute > rMin + 7) continue;

    if (!await shouldSendNotification(user.id, 'daily_goal_reminder', 'all')) continue;

    // Find today's weekly-goal task that's not done
    const goalTask = await queryOne<{ title: string }>(
      "SELECT title FROM tasks WHERE user_id = $1 AND description LIKE $2 AND due_date = $3 AND status != 'done' AND archived = 0 LIMIT 1",
      [user.id, '%[🎯 Цель недели]%', today]
    );

    if (!goalTask) continue;

    telegramService.notifyUser(user.tg_id, `🎯 Главная цель сегодня: <b>${goalTask.title}</b>\n\nУспел? Отметь задачу как выполненную или перенеси на завтра.`);
  }
}

async function checkBhagCoach(): Promise<void> {
  const now = moscowNow();
  const hour = now.getUTCHours();
  const dayOfWeek = now.getUTCDay(); // 5 = Friday
  const today = moscowDateString();

  if (dayOfWeek !== 5 || hour < 18 || hour >= 19) return;

  for (const user of await getUsers()) {
    if (!await shouldSendNotification(user.id, 'bhag_coach', today)) continue;

    // Get active BHAGs
    const bhags = await queryAll<{ id: number; title: string; due_date: string }>(
      "SELECT id, title, due_date FROM goals WHERE type = 'bhag' AND status = 'active' AND user_id = $1",
      [user.id]
    );
    if (bhags.length === 0) continue;

    for (const bhag of bhags) {
      // Get milestones with progress
      const milestones = await queryAll<{ id: number; title: string; due_date: string }>(
        "SELECT id, title, due_date FROM goals WHERE parent_id = $1 AND user_id = $2",
        [bhag.id, user.id]
      );

      let totalTasks = 0, doneTasks = 0;
      const milestoneStats: string[] = [];

      for (const m of milestones) {
        const tasks = await queryAll<{ status: string }>(
          "SELECT status FROM tasks WHERE goal_id = $1 AND user_id = $2 AND archived = 0",
          [m.id, user.id]
        );
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
