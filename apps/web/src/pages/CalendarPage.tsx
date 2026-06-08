import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTasksStore, useProjectsStore } from '../store';
import { TaskDetailPanel } from '../components/kanban/TaskDetailPanel';
import { ProjectFilter } from '../components/filters/ProjectFilter';
import { useFiltersStore } from '../store';
import { peopleApi } from '../api/people.api';
import { apiGet, apiPost } from '../api/client';
import type { Task, Person } from '@pis/shared';
import { useLangStore } from '../store/lang.store';
import { CalendarDays, ChevronLeft, ChevronRight, Link2, Unlink } from 'lucide-react';

interface GCalEvent {
  id: string;
  summary: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
}

type ViewMode = 'day' | '3day' | 'week' | 'month';

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) { days.push(new Date(d)); d.setDate(d.getDate() + 1); }
  return days;
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function getWeekDays(date: Date): Date[] {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
  const mon = new Date(d.setDate(diff));
  return Array.from({ length: 7 }, (_, i) => { const dd = new Date(mon); dd.setDate(mon.getDate() + i); return dd; });
}

export function CalendarPage() {
  const { t } = useLangStore();
  const WEEKDAYS = [t('Пн','Mo'),t('Вт','Tu'),t('Ср','We'),t('Чт','Th'),t('Пт','Fr'),t('Сб','Sa'),t('Вс','Su')];

  const { tasks, fetchTasks } = useTasksStore();
  const { projects, fetchProjects } = useProjectsStore();
  const { selectedProjectIds } = useFiltersStore();
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<Task | null>(null);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<ViewMode>('month');
  const [gcalEvents, setGcalEvents] = useState<GCalEvent[]>([]);
  const [gcalConnected, setGcalConnected] = useState(false);
  const [showCalendarMenu, setShowCalendarMenu] = useState(false);

  // Reset to month view when navigating to calendar
  const location = useLocation();
  useEffect(() => { setView('month'); setCurrentDate(new Date()); }, [location.key]);

  useEffect(() => { fetchTasks(); fetchProjects(); peopleApi.list().then(setPeople).catch(() => {}); }, [fetchTasks, fetchProjects]);
  useEffect(() => {
    apiGet<GCalEvent[]>('/google-calendar/events').then(setGcalEvents).catch(() => {});
    apiGet<{ connected: boolean }>('/google-calendar/status').then(d => setGcalConnected(d.connected)).catch(() => {});
  }, []);

  const today = fmt(new Date());
  const projectMap = new Map(projects.map(p => [p.id, p]));

  const filteredTasks = selectedProjectIds === null
    ? tasks.filter(tk => !tk.archived)
    : tasks.filter(tk => !tk.archived && tk.project_id !== null && selectedProjectIds.has(tk.project_id));

  const tasksByDate = new Map<string, Task[]>();
  for (const tk of filteredTasks) {
    if (tk.due_date) {
      if (!tasksByDate.has(tk.due_date)) tasksByDate.set(tk.due_date, []);
      tasksByDate.get(tk.due_date)!.push(tk);
    }
  }
  const gcalByDate = new Map<string, GCalEvent[]>();
  for (const ev of gcalEvents) {
    const d = ev.start.date || (ev.start.dateTime ? ev.start.dateTime.slice(0, 10) : '');
    if (d) { if (!gcalByDate.has(d)) gcalByDate.set(d, []); gcalByDate.get(d)!.push(ev); }
  }

  const stepMap: Record<ViewMode, number> = { day: 1, '3day': 3, week: 7, month: 0 };
  const prev = () => {
    const d = new Date(currentDate);
    if (view === 'month') d.setMonth(d.getMonth() - 1);
    else d.setDate(d.getDate() - stepMap[view]);
    setCurrentDate(d);
  };
  const next = () => {
    const d = new Date(currentDate);
    if (view === 'month') d.setMonth(d.getMonth() + 1);
    else d.setDate(d.getDate() + stepMap[view]);
    setCurrentDate(d);
  };
  const goToday = () => setCurrentDate(new Date());

  const headerLabel = view === 'day'
    ? currentDate.toLocaleDateString(t('ru-RU','en-US'), { weekday: 'long', day: 'numeric', month: 'long' })
    : view === '3day'
      ? (() => { const end = new Date(currentDate); end.setDate(end.getDate() + 2); return `${currentDate.getDate()} – ${end.getDate()} ${currentDate.toLocaleDateString(t('ru-RU','en-US'), { month: 'short', year: 'numeric' })}`; })()
    : view === 'week'
      ? (() => { const w = getWeekDays(currentDate); return `${w[0]!.getDate()} – ${w[6]!.getDate()} ${w[0]!.toLocaleDateString(t('ru-RU','en-US'), { month: 'short', year: 'numeric' })}`; })()
      : currentDate.toLocaleDateString(t('ru-RU','en-US'), { month: 'long', year: 'numeric' });

  // Get N consecutive days starting from a date
  const getNDays = (start: Date, n: number): Date[] =>
    Array.from({ length: n }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });

  // Parse hour from GCal dateTime (e.g. "2026-05-14T09:00:00+03:00")
  const getHour = (dt?: string): number => {
    if (!dt) return 0;
    const m = dt.match(/T(\d{2}):(\d{2})/);
    return m ? Number(m[1]) + Number(m[2]) / 60 : 0;
  };
  const getDurationHours = (ev: GCalEvent): number => {
    const s = ev.start.dateTime ? getHour(ev.start.dateTime) : 0;
    const e = ev.end.dateTime ? getHour(ev.end.dateTime) : s + 1;
    return Math.max(e - s, 0.5);
  };

  // Render task item
  const TaskItem = ({ tk, idx = 0 }: { tk: Task; idx?: number }) => {
    const proj = tk.project_id ? projectMap.get(tk.project_id) : null;
    return (
      <div onClick={(e) => { e.stopPropagation(); setSelected(tk); }}
        className={`text-xs px-1.5 py-1 rounded-md cursor-pointer truncate transition-all duration-200 hover:scale-[1.02] hover:shadow-sm active:scale-95 animate-[fadeSlideIn_0.3s_ease_both] ${tk.status === 'done' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 line-through' : 'hover:opacity-90'}`}
        style={{
          ...(tk.status !== 'done' && proj ? { backgroundColor: proj.color + '18', color: proj.color } : {}),
          animationDelay: `${idx * 50}ms`,
        }}>
        {tk.title}
      </div>
    );
  };

  const GCalItem = ({ ev, idx = 0 }: { ev: GCalEvent; idx?: number }) => (
    <div className="text-xs px-1.5 py-1 rounded-md truncate bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-300 transition-all duration-200 hover:scale-[1.02] hover:shadow-sm active:scale-95 animate-[fadeSlideIn_0.3s_ease_both]"
      style={{ animationDelay: `${idx * 50}ms` }}>
      {ev.summary}
    </div>
  );

  return (
    <div className="flex flex-col h-full relative overflow-hidden">
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] hidden md:block h-[500px] rounded-full bg-indigo-400/15 dark:bg-indigo-400/[0.10]" style={{ animation: 'circleLeft 30s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute -top-20 -right-20 w-[350px] hidden md:block h-[350px] rounded-full bg-purple-400/12 dark:bg-purple-400/[0.08]" style={{ animation: 'circleLeftSlow 26s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] hidden md:block h-[500px] rounded-full bg-indigo-400/[0.14] dark:bg-violet-400/[0.09] blur-[80px]" style={{ animation: 'circleRight 34s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-10 -left-24 w-[400px] h-[400px] rounded-full bg-purple-400/10 dark:bg-purple-400/[0.08]" style={{ animation: 'circleRightSlow 28s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      {/* Header */}
      <div className="bg-white dark:bg-gray-900 border-b dark:border-gray-700 relative z-10">
        {/* Row 1: navigation */}
        <div className="flex items-center justify-between px-3 md:px-4 pt-2 pb-1">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-cyan-600 flex items-center justify-center shadow-lg shadow-cyan-500/25">
              <CalendarDays size={18} className="text-white" />
            </div>
            <button onClick={prev} className="w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center transition-transform active:scale-90"><ChevronLeft size={18} className="text-gray-500" /></button>
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 capitalize text-center min-w-[160px]">{headerLabel}</span>
            <button onClick={next} className="w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center transition-transform active:scale-90"><ChevronRight size={18} className="text-gray-500" /></button>
          </div>
          <div className="flex items-center gap-2">
            {/* Calendar integrations */}
            <div className="relative">
              <button
                onClick={() => setShowCalendarMenu(v => !v)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-all active:scale-95 ${
                  gcalConnected
                    ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                    : 'border-gray-200 dark:border-gray-600 text-gray-500 hover:border-indigo-300 hover:text-indigo-600'
                }`}
              >
                <Link2 size={14} />
                <span className="hidden md:inline">{t('Интеграции', 'Integrations')}</span>
                {gcalConnected && <span className="w-1.5 h-1.5 rounded-full bg-green-500" />}
              </button>
              {showCalendarMenu && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowCalendarMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 z-40 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-3 w-64 space-y-2">
                    <div className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-1 mb-2">
                      {t('Календари', 'Calendars')}
                    </div>

                    {/* Google Calendar */}
                    <div className="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-white dark:bg-gray-600 flex items-center justify-center shadow-sm">
                          <span className="text-sm">📅</span>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Google Calendar</div>
                          <div className="text-[10px] text-gray-400">{gcalConnected ? t('Подключён', 'Connected') : t('Не подключён', 'Not connected')}</div>
                        </div>
                      </div>
                      {gcalConnected ? (
                        <button
                          onClick={async () => {
                            await apiPost('/google-calendar/disconnect');
                            setGcalConnected(false);
                            setGcalEvents([]);
                          }}
                          className="text-[10px] text-red-500 hover:text-red-700 font-medium flex items-center gap-1 transition-colors"
                        >
                          <Unlink size={10} /> {t('Отключить', 'Disconnect')}
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            const token = localStorage.getItem('auth_token') || '';
                            window.open(`${window.location.origin}/v1/google-calendar/auth${token ? '?token=' + token : ''}`, '_blank');
                          }}
                          className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1 transition-colors"
                        >
                          <Link2 size={10} /> {t('Подключить', 'Connect')}
                        </button>
                      )}
                    </div>

                    {/* Yandex Calendar */}
                    <div className="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-white dark:bg-gray-600 flex items-center justify-center shadow-sm">
                          <span className="text-sm">🟡</span>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">{t('Яндекс Календарь', 'Yandex Calendar')}</div>
                          <div className="text-[10px] text-gray-400">{t('Скоро', 'Coming soon')}</div>
                        </div>
                      </div>
                      <span className="text-[10px] text-gray-300 dark:text-gray-600 font-medium px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded-full">
                        {t('Скоро', 'Soon')}
                      </span>
                    </div>

                    {gcalConnected && (
                      <button
                        onClick={async () => {
                          const res = await apiPost<{ synced: number }>('/google-calendar/sync');
                          const events = await apiGet<GCalEvent[]>('/google-calendar/events');
                          setGcalEvents(events);
                          setShowCalendarMenu(false);
                          alert(t(`Синхронизировано ${res.synced} встреч`, `Synced ${res.synced} meetings`));
                        }}
                        className="w-full text-xs font-medium text-center py-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors"
                      >
                        {t('🔄 Синхронизировать встречи → Google', '🔄 Sync meetings → Google')}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
            <ProjectFilter projects={projects} />
          </div>
        </div>
        {/* Row 2: view switcher */}
        <div className="flex items-center gap-2 px-3 md:px-4 pb-2">
          <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
            {(['day','3day','week','month'] as ViewMode[]).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  view === v ? 'bg-white dark:bg-gray-600 text-gray-800 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400'
                }`}>
                {v === 'day' ? t('День','Day') : v === '3day' ? '3' : v === 'week' ? t('Нед','Wk') : t('Мес','Mo')}
              </button>
            ))}
          </div>
          <button onClick={goToday} className="text-xs text-indigo-600 font-medium px-2 py-1.5">{t('Сегодня','Today')}</button>
        </div>
      </div>

      {/* Content */}
      <div key={`${view}-${fmt(currentDate)}`} className="flex-1 overflow-auto relative z-10 animate-[viewSlide_0.25s_ease]">
        {/* === DAY VIEW === */}
        {view === 'day' && (() => {
          const dateStr = fmt(currentDate);
          const dayTasks = tasksByDate.get(dateStr) ?? [];
          const dayGcal = gcalByDate.get(dateStr) ?? [];
          const isToday = dateStr === today;
          return (
            <div className="flex flex-col h-full">
              {/* Day header */}
              <div className={`text-center py-4 border-b dark:border-gray-700 ${isToday ? 'text-indigo-600' : 'text-gray-500 dark:text-gray-400'}`}>
                <div className="text-4xl font-bold">{currentDate.getDate()}</div>
                <div className="text-base capitalize">{currentDate.toLocaleDateString(t('ru-RU','en-US'), { weekday: 'long', month: 'long' })}</div>
              </div>
              {/* Events list — full width */}
              <div className="flex-1 overflow-auto px-3 md:px-6 py-3">
                {dayGcal.length === 0 && dayTasks.length === 0 && (
                  <div className="text-center text-gray-400 py-12 text-base">{t('Нет событий','No events')}</div>
                )}
                <div className="space-y-2 max-w-2xl mx-auto">
                  {dayGcal.map((ev, i) => (
                    <div key={ev.id} className="p-4 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/30 animate-[fadeSlideIn_0.3s_ease_both] transition-all hover:shadow-md"
                      style={{ animationDelay: `${i * 60}ms` }}>
                      <div className="text-base font-medium text-blue-700 dark:text-blue-300">{ev.summary}</div>
                      <div className="text-xs text-blue-500 mt-1">Google Calendar</div>
                    </div>
                  ))}
                  {dayTasks.map((tk, i) => {
                    const proj = tk.project_id ? projectMap.get(tk.project_id) : null;
                    return (
                      <div key={tk.id} onClick={() => setSelected(tk)}
                        style={{ animationDelay: `${(dayGcal.length + i) * 60}ms` }}
                        className={`p-4 rounded-xl border cursor-pointer transition-all active:scale-[0.98] animate-[fadeSlideIn_0.3s_ease_both] hover:shadow-md ${
                          tk.status === 'done'
                            ? 'bg-green-50 dark:bg-green-900/15 border-green-200 dark:border-green-800/40'
                            : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700/50 hover:border-indigo-300 dark:hover:border-indigo-600'
                        }`}>
                        <div className={`text-base font-medium ${tk.status === 'done' ? 'line-through text-green-700 dark:text-green-400' : 'text-gray-800 dark:text-gray-100'}`}>{tk.title}</div>
                        <div className="flex items-center gap-2 mt-1.5">
                          {proj && <div className="flex items-center gap-1.5 text-xs text-gray-400"><span className="w-2.5 h-2.5 rounded-full" style={{backgroundColor: proj.color}} />{proj.name}</div>}
                          {tk.priority > 0 && <div className="text-xs text-gray-400">{'⭐'.repeat(Math.min(tk.priority, 5))}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()}

        {/* === TIMELINE VIEW (3-day & week) === */}
        {(view === '3day' || view === 'week') && (() => {
          const timelineDays = view === 'week' ? getWeekDays(currentDate) : getNDays(currentDate, 3);
          const HOUR_H = 60; // px per hour
          const HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 06:00–23:00
          const SHORT_WEEKDAYS = [t('Вс','Su'),t('Пн','Mo'),t('Вт','Tu'),t('Ср','We'),t('Чт','Th'),t('Пт','Fr'),t('Сб','Sa')];

          return (
            <div className="flex flex-col h-full">
              {/* Day headers */}
              <div className="flex border-b dark:border-gray-700 bg-white dark:bg-gray-900 sticky top-0 z-10">
                <div className="w-12 flex-shrink-0" />
                {timelineDays.map(day => {
                  const dateStr = fmt(day);
                  const isToday = dateStr === today;
                  const dayTasks = tasksByDate.get(dateStr) ?? [];
                  return (
                    <div key={dateStr} className={`flex-1 text-center py-2 border-l dark:border-gray-700 ${isToday ? 'bg-indigo-50/50 dark:bg-indigo-900/10' : ''}`}>
                      <div className="text-[10px] text-gray-400 uppercase">{SHORT_WEEKDAYS[day.getDay()]}</div>
                      <div className={`text-lg font-bold ${isToday ? 'text-indigo-600' : 'text-gray-700 dark:text-gray-200'}`}>
                        {isToday ? (
                          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-indigo-600 text-white">{day.getDate()}</span>
                        ) : day.getDate()}
                      </div>
                      {/* All-day tasks as dots */}
                      {dayTasks.length > 0 && (
                        <div className="flex gap-0.5 justify-center mt-1">
                          {dayTasks.slice(0, 5).map(tk => {
                            const proj = tk.project_id ? projectMap.get(tk.project_id) : null;
                            return <div key={tk.id} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tk.status === 'done' ? '#22c55e' : (proj?.color ?? '#6366f1') }} />;
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* All-day tasks row */}
              {timelineDays.some(day => (tasksByDate.get(fmt(day)) ?? []).length > 0) && (
                <div className="flex border-b dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30">
                  <div className="w-12 flex-shrink-0 text-[10px] text-gray-400 text-right pr-1.5 pt-1">{t('Весь','All')}</div>
                  {timelineDays.map(day => {
                    const dateStr = fmt(day);
                    const dayTasks = tasksByDate.get(dateStr) ?? [];
                    return (
                      <div key={dateStr} className="flex-1 border-l dark:border-gray-700 p-0.5 space-y-0.5 min-h-[28px]">
                        {dayTasks.slice(0, 3).map(tk => {
                          const proj = tk.project_id ? projectMap.get(tk.project_id) : null;
                          return (
                            <div key={tk.id} onClick={() => setSelected(tk)}
                              className={`text-[10px] px-1 py-0.5 rounded cursor-pointer truncate ${tk.status === 'done' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 line-through' : ''}`}
                              style={tk.status !== 'done' && proj ? { backgroundColor: proj.color + '18', color: proj.color } : undefined}>
                              {tk.title}
                            </div>
                          );
                        })}
                        {dayTasks.length > 3 && <div className="text-[9px] text-gray-400 px-1">+{dayTasks.length - 3}</div>}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Time grid */}
              <div className="flex-1 overflow-auto">
                <div className="relative flex" style={{ height: HOURS.length * HOUR_H }}>
                  {/* Hour labels */}
                  <div className="w-12 flex-shrink-0 relative">
                    {HOURS.map(h => (
                      <div key={h} className="absolute w-full text-right pr-1.5 text-[10px] text-gray-400 -translate-y-1/2"
                        style={{ top: (h - 6) * HOUR_H }}>
                        {String(h).padStart(2, '0')}:00
                      </div>
                    ))}
                  </div>

                  {/* Day columns */}
                  {timelineDays.map(day => {
                    const dateStr = fmt(day);
                    const isToday = dateStr === today;
                    const dayGcal = (gcalByDate.get(dateStr) ?? []).filter(ev => ev.start.dateTime);

                    return (
                      <div key={dateStr} className={`flex-1 relative border-l dark:border-gray-700 ${isToday ? 'bg-indigo-50/30 dark:bg-indigo-900/5' : ''}`}
                        onClick={() => { setCurrentDate(new Date(day)); setView('day'); }}>
                        {/* Hour grid lines */}
                        {HOURS.map(h => (
                          <div key={h} className="absolute w-full border-t border-gray-100 dark:border-gray-700/50"
                            style={{ top: (h - 6) * HOUR_H }} />
                        ))}

                        {/* Current time indicator */}
                        {isToday && (() => {
                          const now = new Date();
                          const nowH = now.getHours() + now.getMinutes() / 60;
                          if (nowH < 6 || nowH > 24) return null;
                          return <div className="absolute w-full border-t-2 border-red-500 z-10" style={{ top: (nowH - 6) * HOUR_H }}>
                            <div className="absolute -left-1 -top-1.5 w-3 h-3 rounded-full bg-red-500" />
                          </div>;
                        })()}

                        {/* GCal events positioned by time */}
                        {dayGcal.map(ev => {
                          const startH = getHour(ev.start.dateTime);
                          const dur = getDurationHours(ev);
                          if (startH < 6) return null;
                          return (
                            <div key={ev.id}
                              className="absolute left-0.5 right-0.5 rounded-md bg-blue-100 dark:bg-blue-900/40 border-l-3 border-blue-500 px-1.5 py-0.5 overflow-hidden cursor-default z-[5]"
                              onClick={(e) => e.stopPropagation()}
                              style={{ top: (startH - 6) * HOUR_H + 1, height: Math.max(dur * HOUR_H - 2, 20) }}>
                              <div className="text-[11px] font-medium text-blue-700 dark:text-blue-300 truncate">{ev.summary}</div>
                              <div className="text-[9px] text-blue-500">{ev.start.dateTime?.slice(11, 16)}</div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()}

        {/* === MONTH VIEW === */}
        {view === 'month' && (() => {
          const year = currentDate.getFullYear();
          const month = currentDate.getMonth();
          const days = getDaysInMonth(year, month);
          const firstDayOfWeek = (days[0]!.getDay() + 6) % 7;
          const paddingBefore: Array<Date | null> = Array.from({ length: firstDayOfWeek }, () => null);
          const allCells = [...paddingBefore, ...days];
          // Split into weeks (rows of 7)
          const weeks: Array<Array<Date | null>> = [];
          for (let i = 0; i < allCells.length; i += 7) {
            weeks.push(allCells.slice(i, i + 7));
          }
          // Pad last week
          const lastWeek = weeks[weeks.length - 1]!;
          while (lastWeek.length < 7) lastWeek.push(null);

          return (
            <div className="p-1 md:p-4">
              {/* Weekday headers with week number column */}
              <div className="grid gap-px" style={{ gridTemplateColumns: '24px repeat(7, 1fr)' }}>
                <div />
                {WEEKDAYS.map(d => (
                  <div key={d} className="text-xs font-semibold text-gray-400 text-center py-1.5">{d}</div>
                ))}
              </div>
              {/* Calendar grid */}
              <div className="rounded-lg overflow-hidden">
                {weeks.map((week, wi) => {
                  const firstDayInWeek = week.find(d => d !== null);
                  const weekNum = firstDayInWeek ? getWeekNumber(firstDayInWeek) : '';
                  return (
                    <div key={wi} className="grid gap-px bg-gray-200 dark:bg-gray-700" style={{ gridTemplateColumns: '24px repeat(7, 1fr)' }}>
                      {/* Week number */}
                      <div className="bg-gray-50 dark:bg-gray-800/50 flex items-start justify-center pt-1.5">
                        <span className="text-[10px] text-gray-400 font-medium">{weekNum}</span>
                      </div>
                      {week.map((day, di) => {
                        if (!day) return <div key={`p-${wi}-${di}`} className="bg-gray-50 dark:bg-gray-800/30 aspect-square md:aspect-auto md:min-h-[110px] min-w-0" />;
                        const dateStr = fmt(day);
                        const dayTasks = tasksByDate.get(dateStr) ?? [];
                        const dayGcal = gcalByDate.get(dateStr) ?? [];
                        const isToday = dateStr === today;
                        const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                        const totalItems = dayTasks.length + dayGcal.length;
                        const maxDesktopItems = 3;
                        return (
                          <div key={dateStr}
                            onClick={() => { setCurrentDate(new Date(day)); setView('day'); }}
                            className={`aspect-square md:aspect-auto md:min-h-[110px] min-w-0 overflow-hidden p-1 md:p-1.5 cursor-pointer transition-all duration-200 hover:bg-gray-50 dark:hover:bg-gray-700/30 hover:shadow-inner active:scale-[0.98] animate-[calendarCellIn_0.3s_ease_both] ${
                              isToday ? 'bg-indigo-50 dark:bg-indigo-900/20 ring-1 ring-indigo-300 dark:ring-indigo-600' : isWeekend ? 'bg-gray-50 dark:bg-gray-800/50' : 'bg-white dark:bg-gray-800'
                            }`}
                            style={{ animationDelay: `${wi * 40 + di * 20}ms` }}>
                            {/* Day number */}
                            <div className={`text-sm font-semibold text-center md:text-left md:px-0.5 md:mb-1 ${
                              isToday ? 'text-indigo-600' : 'text-gray-600 dark:text-gray-300'
                            }`}>
                              {isToday ? (
                                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-indigo-600 text-white text-sm font-bold animate-[todayPulse_2s_ease-in-out_infinite]">{day.getDate()}</span>
                              ) : (
                                day.getDate()
                              )}
                            </div>

                            {/* Mobile: colored dots */}
                            {totalItems > 0 && (
                              <div className="flex flex-wrap gap-0.5 justify-center mt-0.5 md:hidden">
                                {dayGcal.slice(0, 3).map(ev => (
                                  <div key={ev.id} className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                ))}
                                {dayTasks.slice(0, 4).map(tk => {
                                  const proj = tk.project_id ? projectMap.get(tk.project_id) : null;
                                  return (
                                    <div key={tk.id} className="w-1.5 h-1.5 rounded-full"
                                      style={{ backgroundColor: tk.status === 'done' ? '#22c55e' : (proj?.color ?? '#6366f1') }} />
                                  );
                                })}
                                {totalItems > 5 && <div className="text-[8px] text-gray-400 leading-none">+{totalItems - 5}</div>}
                              </div>
                            )}

                            {/* Desktop: text items */}
                            <div className="hidden md:block space-y-0.5">
                              {dayGcal.slice(0, 1).map((ev, i) => <GCalItem key={ev.id} ev={ev} idx={i} />)}
                              {dayTasks.slice(0, maxDesktopItems - Math.min(dayGcal.length, 1)).map((tk, i) => <TaskItem key={tk.id} tk={tk} idx={i} />)}
                              {totalItems > maxDesktopItems && (
                                <div className="text-[10px] text-gray-400 px-0.5">+{totalItems - maxDesktopItems}</div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </div>

      <TaskDetailPanel task={selected} projects={projects} people={people} onClose={() => setSelected(null)} onUpdated={() => fetchTasks()} onDeleted={() => { setSelected(null); fetchTasks(); }} />
    </div>
  );
}
