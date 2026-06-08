import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { apiClient } from '../api/client';
import { useLangStore } from '../store/lang.store';
import { PieChart } from 'lucide-react';

interface Task {
  id: number;
  title: string;
  status: string;
  priority: number;
  project_id: number | null;
  created_at: string;
  updated_at: string;
  archived?: boolean;
}

interface HabitStat {
  id: number;
  title: string;
  icon: string;
  color: string;
  completedDays: number;
  totalDays: number;
  rate: number;
}

interface Habit {
  id: number;
  title: string;
  icon: string;
  streak: number;
}

interface Meeting {
  id: number;
  title: string;
  date: string;
}

interface JournalEntry {
  id: number;
  date: string;
  mood: number;
}

interface Project {
  id: number;
  name: string;
}

const moodEmoji: Record<number, string> = {
  1: '\u{1F622}',
  2: '\u{1F615}',
  3: '\u{1F610}',
  4: '\u{1F642}',
  5: '\u{1F60A}',
};

function getLastNDays(n: number): string[] {
  const days: string[] = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const day = new Date(d);
    day.setDate(d.getDate() - i);
    days.push(day.toISOString().slice(0, 10));
  }
  return days;
}

function getWeekNumber(dateStr: string): number {
  const d = new Date(dateStr);
  const start = new Date(d.getFullYear(), 0, 1);
  const diff = d.getTime() - start.getTime();
  return Math.ceil((diff / 86400000 + start.getDay() + 1) / 7);
}

function shortDay(dateStr: string, lang: 'ru' | 'en'): string {
  const d = new Date(dateStr);
  const daysRu = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const daysEn = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const days = lang === 'en' ? daysEn : daysRu;
  return days[d.getDay()] ?? '';
}

export function StatsPage() {
  const { t, lang } = useLangStore();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [habitStats, setHabitStats] = useState<HabitStat[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiClient.get('/tasks').then((r) => r.data.data || []),
      apiClient.get('/habits/stats').then((r) => r.data.data || []),
      apiClient.get('/habits').then((r) => r.data.data || []),
      apiClient.get('/meetings').then((r) => r.data.data || []),
      apiClient.get('/journal').then((r) => r.data.data || []),
      apiClient.get('/projects').then((r) => r.data.data || []),
    ]).then(([t, hs, h, m, j, p]) => {
      setTasks(t);
      setHabitStats(hs);
      setHabits(h);
      setMeetings(m);
      setJournal(j);
      setProjects(p);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center text-gray-500 dark:text-gray-400">
        {t('Загрузка статистики...', 'Loading statistics...')}
      </div>
    );
  }

  // 1. Tasks per day (last 7 days)
  const last7 = getLastNDays(7);
  const doneTasks = tasks.filter((t) => t.status === 'done');
  const tasksPerDay = last7.map((day) => ({
    day,
    count: doneTasks.filter((t) => t.updated_at?.slice(0, 10) === day).length,
  }));
  const maxTasksDay = Math.max(...tasksPerDay.map((d) => d.count), 1);

  // 3. Meetings per week (last 4 weeks)
  const now = new Date();
  const fourWeeksAgo = new Date(now);
  fourWeeksAgo.setDate(now.getDate() - 28);
  const recentMeetings = meetings.filter(
    (m) => new Date(m.date) >= fourWeeksAgo
  );
  const weekMap = new Map<number, number>();
  for (const m of recentMeetings) {
    const w = getWeekNumber(m.date);
    weekMap.set(w, (weekMap.get(w) || 0) + 1);
  }
  const currentWeek = getWeekNumber(now.toISOString().slice(0, 10));
  const meetingWeeks = [];
  for (let i = 3; i >= 0; i--) {
    const w = currentWeek - i;
    meetingWeeks.push({ week: w, count: weekMap.get(w) || 0 });
  }
  const maxMeetingsWeek = Math.max(...meetingWeeks.map((w) => w.count), 1);

  // 4. Activity by project
  const projectMap = new Map(projects.map((p) => [p.id, p.name]));
  const projectStats: { name: string; created: number; completed: number }[] = [];
  for (const p of projects) {
    const pTasks = tasks.filter((t) => t.project_id === p.id);
    const created = pTasks.length;
    const completed = pTasks.filter((t) => t.status === 'done').length;
    if (created > 0) {
      projectStats.push({ name: p.name, created, completed });
    }
  }
  // Also tasks without a project
  const noProjectTasks = tasks.filter((t) => !t.project_id);
  if (noProjectTasks.length > 0) {
    projectStats.push({
      name: t('Без проекта', 'No project'),
      created: noProjectTasks.length,
      completed: noProjectTasks.filter((t) => t.status === 'done').length,
    });
  }
  const maxProjectTasks = Math.max(...projectStats.map((p) => p.created), 1);

  // 6. Mood timeline (last 14 days)
  const last14 = getLastNDays(14);
  const journalMap = new Map(journal.map((j) => [j.date, j.mood]));

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="relative overflow-hidden p-4 md:p-6 max-w-4xl mx-auto space-y-8">
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] hidden md:block h-[500px] rounded-full bg-indigo-400/15 dark:bg-indigo-400/[0.10]" style={{ animation: 'circleLeft 30s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute -top-20 -right-20 w-[350px] hidden md:block h-[350px] rounded-full bg-purple-400/12 dark:bg-purple-400/[0.08]" style={{ animation: 'circleLeftSlow 26s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] hidden md:block h-[500px] rounded-full bg-indigo-400/[0.14] dark:bg-violet-400/[0.09] blur-[80px]" style={{ animation: 'circleRight 34s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      {/* Header with export buttons */}
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-sky-500 to-sky-600 flex items-center justify-center shadow-lg shadow-sky-500/25">
            <PieChart size={20} className="text-white" />
          </div>
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('Статистика', 'Statistics')}</h1>
        </div>
        <div className="flex gap-2">
          <a
            href="/v1/export/tasks.csv"
            download
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
          >
            {'\u{1F4E5}'} {t('Экспорт задач (CSV)', 'Export tasks (CSV)')}
          </a>
          <a
            href="/v1/export/meetings.csv"
            download
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
          >
            {'\u{1F4E5}'} {t('Экспорт встреч (CSV)', 'Export meetings (CSV)')}
          </a>
        </div>
      </div>

      {/* Velocity — tasks completed per week (last 8 weeks) */}
      <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 }} className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 relative z-10 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 active:scale-[0.98]">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-1">
          {t('Velocity', 'Velocity')}
        </h2>
        <p className="text-xs text-gray-400 mb-4">{t('Задач завершено в неделю', 'Tasks completed per week')}</p>
        {(() => {
          const weeks: Array<{ label: string; count: number }> = [];
          for (let i = 7; i >= 0; i--) {
            const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay() - i * 7 + 1);
            const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
            const ws = weekStart.toISOString().slice(0, 10);
            const we = weekEnd.toISOString().slice(0, 10);
            const count = doneTasks.filter(tk => {
              const d = tk.updated_at?.slice(0, 10) ?? '';
              return d >= ws && d <= we;
            }).length;
            weeks.push({ label: `${weekStart.getDate()}.${weekStart.getMonth() + 1}`, count });
          }
          const maxV = Math.max(...weeks.map(w => w.count), 1);
          const avg = Math.round(weeks.reduce((s, w) => s + w.count, 0) / weeks.length);
          return (
            <>
              <div className="flex items-end gap-2 h-32">
                {weeks.map((w, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">{w.count}</span>
                    <div className="w-full rounded-t-md bg-gradient-to-t from-indigo-600 to-indigo-400 transition-all"
                      style={{ height: `${(w.count / maxV) * 100}%`, minHeight: w.count > 0 ? '4px' : '0px' }} />
                    <span className="text-[10px] text-gray-400">{w.label}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
                <span>{t('Среднее:', 'Average:')} <strong className="text-indigo-600">{avg}</strong> {t('задач/нед', 'tasks/wk')}</span>
                {weeks.length >= 2 && (() => {
                  const last = weeks[weeks.length - 1]!.count;
                  const prev = weeks[weeks.length - 2]!.count;
                  const diff = last - prev;
                  return diff !== 0 ? (
                    <span className={diff > 0 ? 'text-green-600' : 'text-red-500'}>
                      {diff > 0 ? '↑' : '↓'} {Math.abs(diff)} {t('vs прошлая', 'vs prev')}
                    </span>
                  ) : null;
                })()}
              </div>
            </>
          );
        })()}
      </motion.section>

      {/* Burndown — remaining active tasks over last 30 days */}
      <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }} className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 relative z-10 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 active:scale-[0.98]">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-1">
          {t('Burndown', 'Burndown')}
        </h2>
        <p className="text-xs text-gray-400 mb-4">{t('Оставшиеся задачи за 30 дней', 'Remaining tasks over 30 days')}</p>
        {(() => {
          const last30 = getLastNDays(30);
          const activeTasks = tasks.filter(tk => !tk.archived);
          const totalCreated = activeTasks.length;
          // For each day, count how many tasks were still open (not done by that date)
          const points = last30.map(day => {
            const doneByDay = activeTasks.filter(tk => tk.status === 'done' && (tk.updated_at?.slice(0, 10) ?? '') <= day).length;
            return { day, remaining: totalCreated - doneByDay };
          });
          const maxR = Math.max(...points.map(p => p.remaining), 1);
          const minR = Math.min(...points.map(p => p.remaining));
          const range = maxR - minR || 1;
          // SVG line chart
          const w = 100;
          const h = 60;
          const pathPoints = points.map((p, i) => {
            const x = (i / (points.length - 1)) * w;
            const y = h - ((p.remaining - minR) / range) * (h - 10) - 5;
            return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
          }).join(' ');
          const remaining = points[points.length - 1]?.remaining ?? 0;
          const velocity = doneTasks.filter(tk => {
            const d = tk.updated_at?.slice(0, 10) ?? '';
            const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
            return d >= weekAgo.toISOString().slice(0, 10);
          }).length;
          const weeksToZero = velocity > 0 ? Math.ceil(remaining / velocity) : null;
          return (
            <>
              <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-32" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="burnGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity="0.2" />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={`${pathPoints} L${w},${h} L0,${h} Z`} fill="url(#burnGrad)" />
                <path d={pathPoints} fill="none" stroke="#6366f1" strokeWidth="0.5" />
              </svg>
              <div className="flex items-center justify-between text-xs text-gray-400 -mt-1">
                <span>{last30[0]?.slice(5)}</span>
                <span>{t('Сегодня', 'Today')}</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-gray-500">
                <span>{t('Осталось:', 'Remaining:')} <strong className="text-gray-800 dark:text-gray-200">{remaining}</strong> {t('задач', 'tasks')}</span>
                {weeksToZero && (
                  <span>{t('Прогноз:', 'Forecast:')} <strong className="text-indigo-600">~{weeksToZero} {t('нед', 'wk')}</strong></span>
                )}
              </div>
            </>
          );
        })()}
      </motion.section>

      {/* 1. Tasks per week (bar chart) */}
      <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.09 }} className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 active:scale-[0.98]">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">
          {t('Задачи за неделю', 'Tasks this week')}
        </h2>
        <div className="flex items-end gap-2 h-40">
          {tasksPerDay.map(({ day, count }) => (
            <div key={day} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {count}
              </span>
              <div
                className="w-full rounded-t-md bg-indigo-500 transition-all"
                style={{
                  height: `${(count / maxTasksDay) * 100}%`,
                  minHeight: count > 0 ? '4px' : '0px',
                }}
              />
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {shortDay(day, lang)}
              </span>
            </div>
          ))}
        </div>
      </motion.section>

      {/* 2. Habits completion rate */}
      <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 active:scale-[0.98]">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">
          {t('Привычки', 'Habits')}
        </h2>
        {habitStats.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-sm">{t('Нет привычек', 'No habits')}</p>
        ) : (
          <div className="space-y-3">
            {habitStats.map((h) => (
              <div key={h.id}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {h.icon} {h.title}
                  </span>
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    {h.rate}%
                  </span>
                </div>
                <div className="w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${h.rate}%`,
                      backgroundColor: h.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.section>

      {/* 3. Meetings per week */}
      <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 active:scale-[0.98]">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">
          {t('Встречи', 'Meetings')}
        </h2>
        <div className="flex items-end gap-3 h-32">
          {meetingWeeks.map(({ week, count }) => (
            <div key={week} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {count}
              </span>
              <div
                className="w-full rounded-t-md bg-emerald-500 transition-all"
                style={{
                  height: `${(count / maxMeetingsWeek) * 100}%`,
                  minHeight: count > 0 ? '4px' : '0px',
                }}
              />
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {t('Н', 'W')}{week}
              </span>
            </div>
          ))}
        </div>
      </motion.section>

      {/* 4. Activity by project */}
      <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }} className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 active:scale-[0.98]">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">
          {t('Активность по проектам', 'Activity by project')}
        </h2>
        {projectStats.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-sm">{t('Нет данных', 'No data')}</p>
        ) : (
          <div className="space-y-3">
            {projectStats.map((p) => (
              <div key={p.name}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {p.name}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {p.completed}/{p.created}
                  </span>
                </div>
                <div className="w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden relative">
                  <div
                    className="absolute inset-y-0 left-0 bg-blue-200 dark:bg-blue-900 rounded-full"
                    style={{ width: `${(p.created / maxProjectTasks) * 100}%` }}
                  />
                  <div
                    className="absolute inset-y-0 left-0 bg-blue-500 rounded-full"
                    style={{ width: `${(p.completed / maxProjectTasks) * 100}%` }}
                  />
                </div>
              </div>
            ))}
            <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded bg-blue-200 dark:bg-blue-900" /> {t('Создано', 'Created')}
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded bg-blue-500" /> {t('Завершено', 'Completed')}
              </span>
            </div>
          </div>
        )}
      </motion.section>

      {/* 5. Habit streaks */}
      <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.21 }} className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 active:scale-[0.98]">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">
          {t('Streak привычек', 'Habit streaks')}
        </h2>
        {habits.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-sm">{t('Нет привычек', 'No habits')}</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {habits.map((h, i) => (
              <motion.div
                key={h.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200"
              >
                <span className="text-xl">{h.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                    {h.title}
                  </div>
                  <div className="text-lg font-bold text-orange-500">
                    {h.streak > 0 ? `${h.streak} \u{1F525}` : '0'}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </motion.section>

      {/* 6. Mood timeline */}
      <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }} className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 active:scale-[0.98]">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">
          {t('Настроение', 'Mood')}
        </h2>
        <div className="flex items-center gap-1 overflow-x-auto">
          {last14.map((day) => {
            const mood = journalMap.get(day);
            return (
              <div key={day} className="flex flex-col items-center gap-1 min-w-[2.5rem]">
                <span className="text-2xl">
                  {mood ? moodEmoji[mood] || '\u{2753}' : '\u{2796}'}
                </span>
                <span className="text-[10px] text-gray-500 dark:text-gray-400">
                  {day.slice(5)}
                </span>
              </div>
            );
          })}
        </div>
      </motion.section>
    </motion.div>
  );
}
