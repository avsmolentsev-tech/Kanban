import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTasksStore, useProjectsStore } from '../store';
import { TaskDetailPanel } from '../components/kanban/TaskDetailPanel';
import { ProjectFilter } from '../components/filters/ProjectFilter';
import { useFiltersStore } from '../store';
import { peopleApi } from '../api/people.api';
import { apiGet } from '../api/client';
import type { Task, Person } from '@pis/shared';
import { useLangStore } from '../store/lang.store';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

interface GCalEvent {
  id: string;
  summary: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
}

type ViewMode = 'day' | 'week' | 'month';

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) { days.push(new Date(d)); d.setDate(d.getDate() + 1); }
  return days;
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

  // Reset to month view when navigating to calendar
  const location = useLocation();
  useEffect(() => { setView('month'); setCurrentDate(new Date()); }, [location.key]);

  useEffect(() => { fetchTasks(); fetchProjects(); peopleApi.list().then(setPeople).catch(() => {}); }, [fetchTasks, fetchProjects]);
  useEffect(() => { apiGet<GCalEvent[]>('/google-calendar/events').then(setGcalEvents).catch(() => {}); }, []);

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

  const prev = () => {
    const d = new Date(currentDate);
    if (view === 'day') d.setDate(d.getDate() - 1);
    else if (view === 'week') d.setDate(d.getDate() - 7);
    else d.setMonth(d.getMonth() - 1);
    setCurrentDate(d);
  };
  const next = () => {
    const d = new Date(currentDate);
    if (view === 'day') d.setDate(d.getDate() + 1);
    else if (view === 'week') d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
    setCurrentDate(d);
  };
  const goToday = () => setCurrentDate(new Date());

  const headerLabel = view === 'day'
    ? currentDate.toLocaleDateString(t('ru-RU','en-US'), { weekday: 'long', day: 'numeric', month: 'long' })
    : view === 'week'
      ? (() => { const w = getWeekDays(currentDate); return `${w[0]!.getDate()} – ${w[6]!.getDate()} ${w[0]!.toLocaleDateString(t('ru-RU','en-US'), { month: 'short', year: 'numeric' })}`; })()
      : currentDate.toLocaleDateString(t('ru-RU','en-US'), { month: 'long', year: 'numeric' });

  // Render task item
  const TaskItem = ({ tk }: { tk: Task }) => {
    const proj = tk.project_id ? projectMap.get(tk.project_id) : null;
    return (
      <div onClick={() => setSelected(tk)}
        className={`text-[11px] px-1.5 py-0.5 rounded-md cursor-pointer truncate ${tk.status === 'done' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 line-through' : 'hover:opacity-80'}`}
        style={tk.status !== 'done' && proj ? { backgroundColor: proj.color + '18', color: proj.color } : undefined}>
        {tk.title}
      </div>
    );
  };

  const GCalItem = ({ ev }: { ev: GCalEvent }) => (
    <div className="text-[11px] px-1.5 py-0.5 rounded-md truncate bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-300">
      {ev.summary}
    </div>
  );

  return (
    <div className="flex flex-col h-full relative overflow-hidden">
      <style>{`
        @keyframes calDrift1 { 0%,100% { transform: translate(0,0); } 50% { transform: translate(-5px,7px); } }
        @keyframes calDrift2 { 0%,100% { transform: translate(0,0); } 50% { transform: translate(4px,-6px); } }
        @keyframes calDrift3 { 0%,100% { transform: translate(0,0); } 50% { transform: translate(6px,5px); } }
        @keyframes calDrift4 { 0%,100% { transform: translate(0,0); } 50% { transform: translate(-4px,-5px); } }
      `}</style>
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full border border-indigo-400/20 dark:border-indigo-400/[0.07]" style={{ animation: 'calDrift1 30s ease-in-out infinite' }} />
      <div className="pointer-events-none absolute -top-20 -right-20 w-[350px] h-[350px] rounded-full border border-purple-400/25 dark:border-purple-400/[0.08]" style={{ animation: 'calDrift2 26s ease-in-out infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] h-[500px] rounded-full bg-indigo-400/[0.08] dark:bg-indigo-400/[0.04] blur-[80px]" style={{ animation: 'calDrift3 34s ease-in-out infinite' }} />
      <div className="pointer-events-none absolute bottom-10 -left-24 w-[400px] h-[400px] rounded-full border border-purple-400/15 dark:border-purple-400/[0.05]" style={{ animation: 'calDrift4 28s ease-in-out infinite' }} />
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 bg-white dark:bg-gray-900 border-b dark:border-gray-700 gap-2 relative z-10">
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-cyan-600 flex items-center justify-center shadow-lg shadow-cyan-500/25">
            <CalendarDays size={18} className="text-white" />
          </div>
          <div className="flex items-center gap-1">
            <button onClick={prev} className="w-7 h-7 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center"><ChevronLeft size={16} className="text-gray-500" /></button>
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 capitalize min-w-[140px] text-center">{headerLabel}</span>
            <button onClick={next} className="w-7 h-7 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center"><ChevronRight size={16} className="text-gray-500" /></button>
            <button onClick={goToday} className="text-[11px] text-indigo-600 font-medium ml-1">{t('Сегодня','Today')}</button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* View switcher */}
          <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
            {(['day','week','month'] as ViewMode[]).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  view === v ? 'bg-white dark:bg-gray-600 text-gray-800 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400'
                }`}>
                {v === 'day' ? t('День','Day') : v === 'week' ? t('Неделя','Week') : t('Месяц','Month')}
              </button>
            ))}
          </div>
          <ProjectFilter projects={projects} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto relative z-10">
        {/* === DAY VIEW === */}
        {view === 'day' && (() => {
          const dateStr = fmt(currentDate);
          const dayTasks = tasksByDate.get(dateStr) ?? [];
          const dayGcal = gcalByDate.get(dateStr) ?? [];
          const isToday = dateStr === today;
          return (
            <div className="p-4 max-w-lg mx-auto">
              <div className={`text-center mb-4 ${isToday ? 'text-indigo-600' : 'text-gray-500'}`}>
                <div className="text-4xl font-bold">{currentDate.getDate()}</div>
                <div className="text-sm capitalize">{currentDate.toLocaleDateString(t('ru-RU','en-US'), { weekday: 'long' })}</div>
              </div>
              {dayGcal.length === 0 && dayTasks.length === 0 && (
                <div className="text-center text-gray-400 py-8 text-sm">{t('Нет событий','No events')}</div>
              )}
              <div className="space-y-2">
                {dayGcal.map(ev => (
                  <div key={ev.id} className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/30">
                    <div className="text-sm font-medium text-blue-700 dark:text-blue-300">{ev.summary}</div>
                    <div className="text-[11px] text-blue-500 mt-0.5">Google Calendar</div>
                  </div>
                ))}
                {dayTasks.map(tk => {
                  const proj = tk.project_id ? projectMap.get(tk.project_id) : null;
                  return (
                    <div key={tk.id} onClick={() => setSelected(tk)}
                      className={`p-3 rounded-xl border cursor-pointer transition-all active:scale-[0.98] ${
                        tk.status === 'done'
                          ? 'bg-green-50 dark:bg-green-900/15 border-green-200 dark:border-green-800/40'
                          : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700/50 hover:border-indigo-300'
                      }`}>
                      <div className={`text-sm font-medium ${tk.status === 'done' ? 'line-through text-green-700 dark:text-green-400' : 'text-gray-800 dark:text-gray-100'}`}>{tk.title}</div>
                      <div className="flex items-center gap-2 mt-1">
                        {proj && <div className="flex items-center gap-1 text-[11px] text-gray-400"><span className="w-2 h-2 rounded-full" style={{backgroundColor: proj.color}} />{proj.name}</div>}
                        <div className="text-[11px] text-gray-400">{'⭐'.repeat(Math.min(tk.priority, 5))}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* === WEEK VIEW === */}
        {view === 'week' && (() => {
          const weekDays = getWeekDays(currentDate);
          return (
            <div className="p-2">
              <div className="grid grid-cols-7 gap-1">
                {weekDays.map((day, i) => {
                  const dateStr = fmt(day);
                  const dayTasks = tasksByDate.get(dateStr) ?? [];
                  const dayGcal = gcalByDate.get(dateStr) ?? [];
                  const isToday = dateStr === today;
                  const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                  return (
                    <div key={dateStr} className={`rounded-xl p-1.5 min-h-[120px] ${
                      isToday ? 'bg-indigo-50 dark:bg-indigo-900/20 ring-1 ring-indigo-300 dark:ring-indigo-600' : isWeekend ? 'bg-gray-50 dark:bg-gray-800/50' : 'bg-white dark:bg-gray-800/80'
                    }`}>
                      <div className="text-center mb-1">
                        <div className="text-[10px] text-gray-400 uppercase">{WEEKDAYS[i]}</div>
                        <div className={`text-lg font-bold ${isToday ? 'text-indigo-600' : 'text-gray-700 dark:text-gray-200'}`}>{day.getDate()}</div>
                      </div>
                      <div className="space-y-0.5">
                        {dayGcal.slice(0, 3).map(ev => <GCalItem key={ev.id} ev={ev} />)}
                        {dayTasks.slice(0, 4).map(tk => <TaskItem key={tk.id} tk={tk} />)}
                        {dayTasks.length + dayGcal.length > 4 && (
                          <div className="text-[9px] text-gray-400 text-center">+{dayTasks.length + dayGcal.length - 4}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
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
          const paddingBefore = Array.from({ length: firstDayOfWeek }, () => null);
          return (
            <div className="p-2 md:p-4">
              <div className="grid grid-cols-7 mb-1">
                {WEEKDAYS.map(d => (
                  <div key={d} className="text-[10px] font-semibold text-gray-400 text-center py-1">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-px bg-gray-200 dark:bg-gray-700 rounded-lg overflow-hidden">
                {paddingBefore.map((_, i) => <div key={`p-${i}`} className="bg-gray-50 dark:bg-gray-800/30 min-h-[80px] md:min-h-[100px]" />)}
                {days.map(day => {
                  const dateStr = fmt(day);
                  const dayTasks = tasksByDate.get(dateStr) ?? [];
                  const dayGcal = gcalByDate.get(dateStr) ?? [];
                  const isToday = dateStr === today;
                  const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                  const maxItems = 3;
                  const totalItems = dayTasks.length + dayGcal.length;
                  return (
                    <div key={dateStr}
                      onClick={() => { setCurrentDate(new Date(day)); setView('day'); }}
                      className={`min-h-[80px] md:min-h-[100px] p-1 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors ${
                        isToday ? 'bg-indigo-50 dark:bg-indigo-900/20' : isWeekend ? 'bg-gray-50 dark:bg-gray-800/50' : 'bg-white dark:bg-gray-800'
                      }`}>
                      <div className={`text-xs font-medium mb-0.5 px-0.5 ${isToday ? 'text-indigo-600 font-bold' : 'text-gray-500 dark:text-gray-400'}`}>
                        {day.getDate()}
                      </div>
                      <div className="space-y-0.5">
                        {dayGcal.slice(0, 1).map(ev => <GCalItem key={ev.id} ev={ev} />)}
                        {dayTasks.slice(0, maxItems - Math.min(dayGcal.length, 1)).map(tk => <TaskItem key={tk.id} tk={tk} />)}
                        {totalItems > maxItems && (
                          <div className="text-[9px] text-gray-400 px-0.5">+{totalItems - maxItems}</div>
                        )}
                      </div>
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
