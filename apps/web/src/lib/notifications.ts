/** Browser push notifications */

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

export function sendNotification(title: string, body: string, icon?: string): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification(title, {
      body,
      icon: icon ?? '/icon.svg',
      badge: '/icon.svg',
    });
  } catch {}
}

// --- Deduplication: track notification keys in sessionStorage so they aren't repeated
// within the same browser session. Key format: "<type>:<id>:<date>"
function hasShown(key: string): boolean {
  try {
    const shown = JSON.parse(sessionStorage.getItem('pis_notif_shown') ?? '[]') as string[];
    return shown.includes(key);
  } catch {
    return false;
  }
}

function markShown(key: string): void {
  try {
    const shown = JSON.parse(sessionStorage.getItem('pis_notif_shown') ?? '[]') as string[];
    if (!shown.includes(key)) {
      shown.push(key);
      // Keep the list bounded to the last 200 entries
      if (shown.length > 200) shown.splice(0, shown.length - 200);
      sessionStorage.setItem('pis_notif_shown', JSON.stringify(shown));
    }
  } catch {}
}

function todayString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Check tasks: notify for overdue tasks and tasks due today */
async function checkTaskNotifications(): Promise<void> {
  const today = todayString();

  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const res = await fetch('/v1/tasks', { headers });
  const data = await res.json();
  if (!data.success) return;

  type TaskRow = { id: number; title: string; due_date: string | null; status: string };
  const tasks = data.data as TaskRow[];

  // Overdue tasks (due before today, not done/someday)
  const overdue = tasks.filter(
    t => t.due_date && t.due_date < today && t.status !== 'done' && t.status !== 'someday',
  );

  // Tasks due today (not done/someday)
  const dueToday = tasks.filter(
    t => t.due_date === today && t.status !== 'done' && t.status !== 'someday',
  );

  // Aggregate overdue into a single notification per check cycle (keyed by date + count)
  if (overdue.length > 0) {
    const key = `overdue:${today}:${overdue.length}`;
    if (!hasShown(key)) {
      sendNotification(
        `Просрочено: ${overdue.length} задач`,
        overdue.slice(0, 3).map(t => t.title).join(', '),
      );
      markShown(key);
    }
  }

  // One notification per task due today
  for (const task of dueToday) {
    const key = `today:${task.id}:${today}`;
    if (!hasShown(key)) {
      sendNotification(
        'Задача на сегодня',
        task.title,
      );
      markShown(key);
    }
  }
}

/** Check meetings: notify for meetings happening today */
async function checkMeetingNotifications(): Promise<void> {
  const today = todayString();

  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const res = await fetch('/v1/meetings', { headers });
  const data = await res.json();
  // API returns array directly or wrapped — handle both shapes
  const meetings: Array<{ id: number; title: string; date: string }> = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : [];

  // Meetings whose date starts with today (date can be "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm")
  const upcoming = meetings.filter(m => m.date && m.date.startsWith(today));

  for (const meeting of upcoming) {
    const key = `meeting:${meeting.id}:${today}`;
    if (!hasShown(key)) {
      const timeLabel = meeting.date.length > 10
        ? ` в ${meeting.date.slice(11, 16)}`
        : '';
      sendNotification(
        `Встреча сегодня${timeLabel}`,
        meeting.title,
      );
      markShown(key);
    }
  }
}

/**
 * Run all notification checks.
 * Called on app load and every 30 min from App.tsx.
 */
export async function checkAndNotifyOverdue(): Promise<void> {
  try {
    await checkTaskNotifications();
  } catch {}
  try {
    await checkMeetingNotifications();
  } catch {}
}
