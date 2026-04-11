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

/** Check for overdue tasks and notify */
export async function checkAndNotifyOverdue(): Promise<void> {
  try {
    const res = await fetch('/v1/tasks');
    const data = await res.json();
    if (!data.success) return;

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const overdue = (data.data as Array<{ title: string; due_date: string | null; status: string }>)
      .filter(t => t.due_date && t.due_date < today && t.status !== 'done' && t.status !== 'someday');

    if (overdue.length > 0) {
      sendNotification(
        `Просрочено: ${overdue.length} задач`,
        overdue.slice(0, 3).map(t => t.title).join(', '),
      );
    }
  } catch {}
}
