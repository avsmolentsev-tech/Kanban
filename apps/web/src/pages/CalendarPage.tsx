import { useEffect, useState } from 'react';
import { useTasksStore, useProjectsStore } from '../store';
import { TaskDetailPanel } from '../components/kanban/TaskDetailPanel';
import { ProjectFilter } from '../components/filters/ProjectFilter';
import { useFiltersStore } from '../store';
import { peopleApi } from '../api/people.api';
import { apiGet } from '../api/client';
import type { Task, Person } from '@pis/shared';
import { useLangStore } from '../store/lang.store';

interface GCalEvent {
  id: string;
  summary: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
}

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function formatDate(d: Date): string {
  // Use LOCAL date, not UTC — avoids timezone shift
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function CalendarPage() {
  const { t } = useLangStore();

  const WEEKDAYS = [
    t('Пн', 'Mo'),
    t('Вт', 'Tu'),
    t('Ср', 'We'),
    t('Чт', 'Th'),
    t('Пт', 'Fr'),
    t('Сб', 'Sa'),
    t('Вс', 'Su'),
  ];
  const { tasks, fetchTasks } = useTasksStore();
  const { projects, fetchProjects } = useProjectsStore();
  const { selectedProjectIds } = useFiltersStore();
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<Task | null>(null);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [gcalEvents, setGcalEvents] = useState<GCalEvent[]>([]);

  useEffect(() => { fetchTasks(); fetchProjects(); peopleApi.list().then(setPeople).catch(() => {}); }, [fetchTasks, fetchProjects]);
  useEffect(() => { apiGet<GCalEvent[]>('/google-calendar/events').then(setGcalEvents).catch(() => {}); }, []);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const days = getDaysInMonth(year, month);
  const today = formatDate(new Date());

  // Start padding (Monday = 0)
  const firstDayOfWeek = (days[0]!.getDay() + 6) % 7; // Monday-based
  const paddingBefore = Array.from({ length: firstDayOfWeek }, () => null);

  // Filter tasks
  const filteredTasks = selectedProjectIds === null
    ? tasks.filter(t => !t.archived)
    : tasks.filter(t => !t.archived && t.project_id !== null && selectedProjectIds.has(t.project_id));

  // Group tasks by date
  const tasksByDate = new Map<string, Task[]>();
  for (const t of filteredTasks) {
    if (t.due_date) {
      if (!tasksByDate.has(t.due_date)) tasksByDate.set(t.due_date, []);
      tasksByDate.get(t.due_date)!.push(t);
    }
  }

  // Group Google Calendar events by date
  const gcalByDate = new Map<string, GCalEvent[]>();
  for (const ev of gcalEvents) {
    const d = ev.start.date || (ev.start.dateTime ? ev.start.dateTime.slice(0, 10) : '');
    if (d) {
      if (!gcalByDate.has(d)) gcalByDate.set(d, []);
      gcalByDate.get(d)!.push(ev);
    }
  }

  const projectMap = new Map(projects.map(p => [p.id, p]));

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToday = () => setCurrentDate(new Date());

  const monthName = currentDate.toLocaleDateString(t('ru-RU', 'en-US'), { month: 'long', year: 'numeric' });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 pt-4 pb-2 bg-white dark:bg-gray-900 border-b dark:border-gray-700">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('Календарь', 'Calendar')}</h1>
          <div className="flex items-center gap-1">
            <button onClick={prevMonth} className="w-7 h-7 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 text-sm">←</button>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200 capitalize w-40 text-center">{monthName}</span>
            <button onClick={nextMonth} className="w-7 h-7 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 text-sm">→</button>
            <button onClick={goToday} className="text-xs text-indigo-600 hover:text-indigo-800 ml-2">{t('Сегодня', 'Today')}</button>
          </div>
        </div>
        <ProjectFilter projects={projects} />
      </div>

      <div className="flex-1 overflow-auto p-4">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 mb-1">
          {WEEKDAYS.map(d => (
            <div key={d} className="text-xs font-semibold text-gray-400 text-center py-1">{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-px bg-gray-200 dark:bg-gray-700 rounded-lg overflow-hidden">
          {paddingBefore.map((_, i) => (
            <div key={`pad-${i}`} className="bg-gray-50 min-h-[100px]" />
          ))}
          {days.map(day => {
            const dateStr = formatDate(day);
            const dayTasks = tasksByDate.get(dateStr) ?? [];
            const dayGcal = gcalByDate.get(dateStr) ?? [];
            const isToday = dateStr === today;
            const isWeekend = day.getDay() === 0 || day.getDay() === 6;
            const maxItems = 4;
            const totalItems = dayTasks.length + dayGcal.length;

            return (
              <div key={dateStr} className={`min-h-[100px] p-1 ${isToday ? 'bg-indigo-50 dark:bg-indigo-900/20' : isWeekend ? 'bg-gray-50 dark:bg-gray-800/50' : 'bg-white dark:bg-gray-800'}`}>
                <div className={`text-xs font-medium mb-1 px-1 ${isToday ? 'text-indigo-600 font-bold' : 'text-gray-500 dark:text-gray-400'}`}>
                  {day.getDate()}
                </div>
                <div className="space-y-0.5">
                  {dayGcal.slice(0, 2).map(ev => (
                    <div key={ev.id} className="text-[10px] px-1 py-0.5 rounded truncate bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                      📅 {ev.summary}
                    </div>
                  ))}
                  {dayTasks.slice(0, maxItems - Math.min(dayGcal.length, 2)).map(t => {
                    const proj = t.project_id ? projectMap.get(t.project_id) : null;
                    return (
                      <div key={t.id} onClick={() => setSelected(t)}
                        className={`text-[10px] px-1 py-0.5 rounded cursor-pointer truncate ${t.status === 'done' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 line-through' : 'hover:opacity-80'}`}
                        style={t.status !== 'done' && proj ? { backgroundColor: proj.color + '22', color: proj.color } : undefined}>
                        {t.title}
                      </div>
                    );
                  })}
                  {totalItems > maxItems && (
                    <div className="text-[10px] text-gray-400 px-1">+{totalItems - maxItems} {t('ещё', 'more')}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <TaskDetailPanel task={selected} projects={projects} people={people} onClose={() => setSelected(null)} onUpdated={() => fetchTasks()} onDeleted={() => { setSelected(null); fetchTasks(); }} />
    </div>
  );
}
