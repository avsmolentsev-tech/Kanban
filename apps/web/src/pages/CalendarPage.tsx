import { useEffect, useState } from 'react';
import { useTasksStore, useProjectsStore } from '../store';
import { TaskDetailPanel } from '../components/kanban/TaskDetailPanel';
import { ProjectFilter } from '../components/filters/ProjectFilter';
import { useFiltersStore } from '../store';
import { peopleApi } from '../api/people.api';
import type { Task, Person } from '@pis/shared';

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
  return d.toISOString().split('T')[0]!;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function CalendarPage() {
  const { tasks, fetchTasks } = useTasksStore();
  const { projects, fetchProjects } = useProjectsStore();
  const { selectedProjectIds } = useFiltersStore();
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<Task | null>(null);
  const [currentDate, setCurrentDate] = useState(new Date());

  useEffect(() => { fetchTasks(); fetchProjects(); peopleApi.list().then(setPeople).catch(() => {}); }, [fetchTasks, fetchProjects]);

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

  const projectMap = new Map(projects.map(p => [p.id, p]));

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToday = () => setCurrentDate(new Date());

  const monthName = currentDate.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 pt-4 pb-2 bg-white border-b">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-gray-800">Calendar</h1>
          <div className="flex items-center gap-1">
            <button onClick={prevMonth} className="w-7 h-7 rounded hover:bg-gray-100 text-gray-500 text-sm">←</button>
            <span className="text-sm font-medium text-gray-700 capitalize w-40 text-center">{monthName}</span>
            <button onClick={nextMonth} className="w-7 h-7 rounded hover:bg-gray-100 text-gray-500 text-sm">→</button>
            <button onClick={goToday} className="text-xs text-indigo-600 hover:text-indigo-800 ml-2">Today</button>
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
        <div className="grid grid-cols-7 gap-px bg-gray-200 rounded-lg overflow-hidden">
          {paddingBefore.map((_, i) => (
            <div key={`pad-${i}`} className="bg-gray-50 min-h-[100px]" />
          ))}
          {days.map(day => {
            const dateStr = formatDate(day);
            const dayTasks = tasksByDate.get(dateStr) ?? [];
            const isToday = dateStr === today;
            const isWeekend = day.getDay() === 0 || day.getDay() === 6;

            return (
              <div key={dateStr} className={`min-h-[100px] p-1 ${isToday ? 'bg-indigo-50' : isWeekend ? 'bg-gray-50' : 'bg-white'}`}>
                <div className={`text-xs font-medium mb-1 px-1 ${isToday ? 'text-indigo-600 font-bold' : 'text-gray-500'}`}>
                  {day.getDate()}
                </div>
                <div className="space-y-0.5">
                  {dayTasks.slice(0, 4).map(t => {
                    const proj = t.project_id ? projectMap.get(t.project_id) : null;
                    return (
                      <div key={t.id} onClick={() => setSelected(t)}
                        className={`text-[10px] px-1 py-0.5 rounded cursor-pointer truncate ${t.status === 'done' ? 'bg-green-100 text-green-700 line-through' : 'hover:opacity-80'}`}
                        style={t.status !== 'done' && proj ? { backgroundColor: proj.color + '22', color: proj.color } : undefined}>
                        {t.title}
                      </div>
                    );
                  })}
                  {dayTasks.length > 4 && (
                    <div className="text-[10px] text-gray-400 px-1">+{dayTasks.length - 4} more</div>
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
