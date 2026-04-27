import { useEffect, useState, useRef } from 'react';
import { apiGet } from '../api/client';
import { TaskDetailPanel } from '../components/kanban/TaskDetailPanel';
import { peopleApi } from '../api/people.api';
import type { Task, Project, Person } from '@pis/shared';
import { useLangStore } from '../store/lang.store';
import { GanttChart } from 'lucide-react';

function formatShortDate(d: Date, lang: 'ru' | 'en'): string {
  const day = d.getDate();
  const monthsRu = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const monthsEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const months = lang === 'en' ? monthsEn : monthsRu;
  return `${day} ${months[d.getMonth()]}`;
}

function formatDateKey(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

const DAY_WIDTH = 40;
const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 48;
const PROJECT_LABEL_WIDTH = 180;
const TOTAL_DAYS = 30;

export function GanttPage() {
  const { t, lang } = useLangStore();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<Task | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiGet<Task[]>('/tasks').then(setTasks).catch(() => {});
    apiGet<Project[]>('/projects').then(setProjects).catch(() => {});
    peopleApi.list().then(setPeople).catch(() => {});
  }, []);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days: Date[] = [];
  for (let i = 0; i < TOTAL_DAYS; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    days.push(d);
  }

  const startDate = days[0]!;

  // Group tasks by project
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const grouped = new Map<number | null, Task[]>();

  for (const t of tasks) {
    if (!t.due_date && !t.start_date) continue;
    if (t.archived) continue;
    const key = t.project_id ?? null;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(t);
  }

  // Build ordered rows
  const rows: Array<{ project: Project | null; tasks: Task[] }> = [];
  for (const p of projects) {
    const pts = grouped.get(p.id);
    if (pts && pts.length > 0) rows.push({ project: p, tasks: pts });
  }
  const unassigned = grouped.get(null);
  if (unassigned && unassigned.length > 0) rows.push({ project: null, tasks: unassigned });

  const todayOffset = 0; // today is always first column

  const refresh = () => {
    apiGet<Task[]>('/tasks').then(setTasks).catch(() => {});
  };

  return (
    <div className="relative overflow-hidden h-full flex flex-col">
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full border-2 border-indigo-400/30 dark:border-white/[0.12]" style={{ animation: 'circleLeft 16s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute -top-20 -right-20 w-[350px] h-[350px] rounded-full border-2 border-purple-400/35 dark:border-white/[0.12]" style={{ animation: 'circleLeftSlow 12s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] h-[500px] rounded-full bg-indigo-400/[0.14] dark:bg-white/[0.06] blur-[80px]" style={{ animation: 'circleRight 20s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="relative z-10 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center shadow-lg shadow-green-500/25">
            <GanttChart size={20} className="text-white" />
          </div>
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('Диаграмма Ганта', 'Gantt Chart')}</h1>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">{t('Ближайшие 30 дней', 'Next 30 days')}</p>
      </div>

      <div ref={scrollRef} className="relative z-10 flex-1 overflow-auto">
        <div style={{ minWidth: PROJECT_LABEL_WIDTH + TOTAL_DAYS * DAY_WIDTH }}>
          {/* Header row with dates */}
          <div
            className="flex sticky top-0 z-20 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700"
            style={{ height: HEADER_HEIGHT }}
          >
            <div
              className="sticky left-0 z-30 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex items-center px-3"
              style={{ width: PROJECT_LABEL_WIDTH, minWidth: PROJECT_LABEL_WIDTH }}
            >
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{t('Проект', 'Project')}</span>
            </div>
            <div className="flex relative">
              {days.map((d, i) => {
                const isToday = i === todayOffset;
                const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                return (
                  <div
                    key={i}
                    className={`flex flex-col items-center justify-center text-xs border-r border-gray-100 dark:border-gray-700 ${
                      isToday ? 'bg-red-50 dark:bg-red-900/20 font-bold text-red-600 dark:text-red-400' : isWeekend ? 'bg-gray-50 dark:bg-gray-800/50 text-gray-400' : 'text-gray-500 dark:text-gray-400'
                    }`}
                    style={{ width: DAY_WIDTH, minWidth: DAY_WIDTH }}
                  >
                    <span>{formatShortDate(d, lang)}</span>
                    <span className="text-[10px]">{(lang === 'en' ? ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] : ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'])[d.getDay()]}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Rows */}
          {rows.map(({ project, tasks: pTasks }) => (
            <div key={project?.id ?? 'none'} className="border-b border-gray-100 dark:border-gray-700">
              {/* Project header */}
              <div className="flex" style={{ minHeight: ROW_HEIGHT }}>
                <div
                  className="sticky left-0 z-10 bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex items-center px-3 gap-2"
                  style={{ width: PROJECT_LABEL_WIDTH, minWidth: PROJECT_LABEL_WIDTH }}
                >
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: project?.color ?? '#9ca3af' }}
                  />
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 truncate">
                    {project?.name ?? t('Без проекта', 'No project')}
                  </span>
                  <span className="text-xs text-gray-400 ml-auto">{pTasks.length}</span>
                </div>
                <div style={{ width: TOTAL_DAYS * DAY_WIDTH }} />
              </div>

              {/* Task bars */}
              {pTasks.map((task) => {
                const taskStart = task.start_date ? new Date(task.start_date) : task.due_date ? new Date(task.due_date) : null;
                const taskEnd = task.due_date ? new Date(task.due_date) : task.start_date ? new Date(task.start_date) : null;
                if (!taskStart || !taskEnd) return null;

                taskStart.setHours(0, 0, 0, 0);
                taskEnd.setHours(0, 0, 0, 0);

                const offsetDays = daysBetween(startDate, taskStart);
                const duration = Math.max(1, daysBetween(taskStart, taskEnd) + 1);

                const barLeft = offsetDays * DAY_WIDTH;
                const barWidth = duration * DAY_WIDTH - 4;

                // Skip tasks entirely outside the visible range
                if (offsetDays + duration < 0 || offsetDays >= TOTAL_DAYS) return null;

                const barColor = project?.color ?? '#6366f1';

                return (
                  <div key={task.id} className="flex" style={{ height: ROW_HEIGHT }}>
                    <div
                      className="sticky left-0 z-10 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex items-center px-3"
                      style={{ width: PROJECT_LABEL_WIDTH, minWidth: PROJECT_LABEL_WIDTH }}
                    >
                      <span className="text-xs text-gray-500 dark:text-gray-400 truncate pl-5">{task.title}</span>
                    </div>
                    <div className="relative" style={{ width: TOTAL_DAYS * DAY_WIDTH }}>
                      <div
                        className="absolute top-1 rounded cursor-pointer hover:opacity-80 transition-opacity flex items-center px-2 overflow-hidden"
                        style={{
                          left: Math.max(0, barLeft),
                          width: Math.max(DAY_WIDTH - 4, barWidth),
                          height: ROW_HEIGHT - 8,
                          backgroundColor: barColor,
                          opacity: 0.85,
                        }}
                        onClick={() => setSelected(task)}
                        title={task.title}
                      >
                        <span className="text-[10px] text-white font-medium truncate">{task.title}</span>
                      </div>

                      {/* Today line */}
                      <div
                        className="absolute top-0 bottom-0 border-l-2 border-dashed border-red-500 pointer-events-none"
                        style={{ left: todayOffset * DAY_WIDTH + DAY_WIDTH / 2 }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          {rows.length === 0 && (
            <div className="flex items-center justify-center h-40 text-gray-400 dark:text-gray-500">
              {t('Нет задач с датами для отображения на диаграмме', 'No tasks with dates to display on the chart')}
            </div>
          )}
        </div>
      </div>

      <TaskDetailPanel
        task={selected}
        projects={projects}
        people={people}
        onClose={() => setSelected(null)}
        onUpdated={() => { refresh(); setSelected(null); }}
      />
    </div>
  );
}
