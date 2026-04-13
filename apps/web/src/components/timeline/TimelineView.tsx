import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
// Timeline uses dragMode="draggable" on TaskCards (not sortable) so cards can move between columns
import { CSS } from '@dnd-kit/utilities';
import type { Task, Project, Person } from '@pis/shared';
import { TaskCard } from '../kanban/TaskCard';
import { TaskCreatePanel, type CreatePeriod } from '../kanban/TaskCreatePanel';

export type TimePeriod = 'today' | 'tomorrow' | 'week' | 'month' | 'year';

export { classifyTask };

const PERIOD_LABELS: Record<TimePeriod, string> = {
  today: 'Сегодня',
  tomorrow: 'Завтра',
  week: 'На неделе',
  month: 'В этом месяце',
  year: 'В этом году',
};

const PERIODS: TimePeriod[] = ['today', 'tomorrow', 'week', 'month', 'year'];

function classifyTask(dueDate: string | null): TimePeriod | 'none' {
  if (!dueDate) return 'none';
  const due = new Date(dueDate);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const dayAfterTomorrow = new Date(today); dayAfterTomorrow.setDate(today.getDate() + 2);

  // Overdue → today
  if (due < today) return 'today';

  // Today
  if (due >= today && due < tomorrow) return 'today';

  // Tomorrow
  if (due >= tomorrow && due < dayAfterTomorrow) return 'tomorrow';

  // This week (days 3-7 from today)
  const weekEnd = new Date(today);
  weekEnd.setDate(today.getDate() + 7);
  if (due >= dayAfterTomorrow && due < weekEnd) return 'week';

  // This month (rest of month after this week)
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  if (due >= weekEnd && due <= endOfMonth) return 'month';

  // This year
  if (due.getFullYear() === now.getFullYear() && due > endOfMonth) return 'year';

  return 'year';
}

function columnToPeriod(col: TimePeriod | 'none' | 'done' | 'someday' | 'backlog'): CreatePeriod {
  if (col === 'done') return 'today';
  if (col === 'none') return 'none';
  if (col === 'someday') return 'someday';
  if (col === 'backlog') return 'backlog';
  return col;
}

function TimelineColumn({ period, tasks, projects, onTaskClick, onToggleDone, projectId, people, onRefresh }: {
  period: TimePeriod | 'none' | 'done' | 'someday' | 'backlog'; tasks: Task[]; projects: Project[]; onTaskClick: (t: Task) => void;
  onToggleDone: (id: number, newStatus: import('@pis/shared').TaskStatus) => void;
  projectId: number | null; people: Person[]; onRefresh: () => void;
}) {
  // Unique droppable ID per project+period combination
  const droppableId = `timeline-${projectId ?? 'none'}-${period}`;
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });
  const pMap = new Map(projects.map((p) => [p.id, p]));
  const [adding, setAdding] = useState(false);

  return (
    <div ref={setNodeRef}
      className={`flex flex-col w-64 min-w-[256px] bg-gray-100 rounded-xl p-3 transition-colors ${isOver ? 'bg-indigo-50' : ''}`}>
      <div className="flex flex-col gap-2 flex-1 min-h-[60px]">
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} project={t.project_id ? pMap.get(t.project_id) : undefined} onClick={() => onTaskClick(t)} onToggleDone={onToggleDone} dragMode="draggable" />
        ))}
        {tasks.length === 0 && <div className="text-gray-300 text-xs text-center py-4">Перетащи сюда</div>}
      </div>
      <button onClick={() => setAdding(true)} className="mt-2 text-xs text-gray-400 hover:text-indigo-600 transition-colors self-center">+ Добавить</button>
      <TaskCreatePanel
        open={adding}
        projects={projects}
        people={people}
        initialProjectId={projectId}
        initialPeriod={columnToPeriod(period)}
        onClose={() => setAdding(false)}
        onCreated={onRefresh}
      />
    </div>
  );
}

function SortableProjectRow({ id, children }: { id: string; children: (dragHandleProps: Record<string, unknown>) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.7 : 1 };
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {children({ ...listeners })}
    </div>
  );
}

interface Props {
  tasks: Task[];
  projects: Project[];
  people: Person[];
  onTaskClick: (t: Task) => void;
  onToggleDone: (id: number, newStatus: import('@pis/shared').TaskStatus) => void;
  onReorderProjects: (items: Array<{ id: number; order_index: number }>) => void;
  onRefresh: () => void;
}

export function TimelineView({ tasks, projects, people, onTaskClick, onToggleDone, onReorderProjects, onRefresh }: Props) {
  const activeTasks = tasks.filter((t) => !t.archived);

  // Group by project
  const tasksByProject = new Map<number | null, Task[]>();
  for (const t of activeTasks) {
    const key = t.project_id;
    if (!tasksByProject.has(key)) tasksByProject.set(key, []);
    tasksByProject.get(key)!.push(t);
  }

  const projectOrder: Array<{ project: Project | null; tasks: Task[] }> = [];
  for (const p of projects) {
    const pts = tasksByProject.get(p.id);
    projectOrder.push({ project: p, tasks: pts ?? [] });
  }
  const unassigned = tasksByProject.get(null);
  if (unassigned && unassigned.length > 0) {
    projectOrder.push({ project: null, tasks: unassigned });
  }

  return (
    <div className="relative overflow-auto h-full">
      {/* Sticky column headers */}
      <div className="sticky top-0 z-30 flex bg-gray-50/90 dark:bg-gray-900/90 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 py-2">
        {/* Corner cell */}
        <div className="sticky left-0 z-40 w-40 min-w-[160px] flex-shrink-0 pl-4" style={{ background: 'inherit' }} />
        <div className="w-64 min-w-[256px] mx-2 text-sm font-semibold text-purple-600 text-center">Бэклог</div>
        {PERIODS.map((p) => (
          <div key={p} className="w-64 min-w-[256px] mx-2 text-sm font-semibold text-gray-500 text-center">
            {PERIOD_LABELS[p]}
          </div>
        ))}
        <div className="w-64 min-w-[256px] mx-2 text-sm font-semibold text-gray-400 text-center">Без даты</div>
        <div className="w-64 min-w-[256px] mx-2 text-sm font-semibold text-green-600 text-center">Готово</div>
        <div className="w-64 min-w-[256px] mx-2 text-sm font-semibold text-gray-400 text-center">Когда-нибудь</div>
      </div>

      {/* Project swimlanes */}
      <div className="p-4 pt-2">
        <SortableContext items={projectOrder.map((p) => `project-row-${p.project?.id ?? 'none'}`)} strategy={verticalListSortingStrategy}>
          {projectOrder.map(({ project, tasks: pTasks }) => {
            const grouped: Record<TimePeriod | 'none' | 'done' | 'someday' | 'backlog', Task[]> = { backlog: [], today: [], tomorrow: [], week: [], month: [], year: [], none: [], done: [], someday: [] };
            for (const t of pTasks) {
              if (t.status === 'done') {
                grouped.done.push(t);
              } else if (t.status === 'someday') {
                grouped.someday.push(t);
              } else if (t.status === 'backlog') {
                grouped.backlog.push(t);
              } else {
                grouped[classifyTask(t.due_date)].push(t);
              }
            }

            return (
              <SortableProjectRow key={project?.id ?? 'none'} id={`project-row-${project?.id ?? 'none'}`}>
                {(dragHandleProps) => (
                  <div className="flex mb-4">
                    {/* Sticky project label (left) */}
                    <div className="sticky left-0 top-12 z-20 w-40 min-w-[160px] flex-shrink-0 pr-3 pt-3 self-start" style={{ background: 'inherit' }}>
                      <div className="flex items-center gap-2">
                        {project && (
                          <div
                            className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 text-base leading-none flex-shrink-0 select-none"
                            {...dragHandleProps}
                          >
                            ⠿
                          </div>
                        )}
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: project?.color ?? '#9ca3af' }} />
                        <span className="text-sm font-semibold text-gray-700 truncate">{project?.name ?? 'Без проекта'}</span>
                      </div>
                      <div className="text-xs text-gray-400 mt-1 ml-5">{pTasks.length} задач{pTasks.length === 1 ? 'а' : pTasks.length > 4 || pTasks.length === 0 ? '' : 'и'}</div>
                    </div>

                    {/* Period columns */}
                    <div className="flex gap-4">
                      <TimelineColumn period="backlog" tasks={grouped.backlog} projects={projects} onTaskClick={onTaskClick}
                        onToggleDone={onToggleDone} projectId={project?.id ?? null} people={people} onRefresh={onRefresh} />
                      {PERIODS.map((period) => (
                        <TimelineColumn key={`${project?.id ?? 'none'}-${period}`} period={period} tasks={grouped[period]} projects={projects}
                          onTaskClick={onTaskClick} onToggleDone={onToggleDone} projectId={project?.id ?? null} people={people} onRefresh={onRefresh} />
                      ))}
                      <TimelineColumn period="none" tasks={grouped.none} projects={projects} onTaskClick={onTaskClick}
                        onToggleDone={onToggleDone} projectId={project?.id ?? null} people={people} onRefresh={onRefresh} />
                      <TimelineColumn period="done" tasks={grouped.done} projects={projects} onTaskClick={onTaskClick}
                        onToggleDone={onToggleDone} projectId={project?.id ?? null} people={people} onRefresh={onRefresh} />
                      <TimelineColumn period="someday" tasks={grouped.someday} projects={projects} onTaskClick={onTaskClick}
                        onToggleDone={onToggleDone} projectId={project?.id ?? null} people={people} onRefresh={onRefresh} />
                    </div>
                  </div>
                )}
              </SortableProjectRow>
            );
          })}
        </SortableContext>

        {projectOrder.length === 0 && <div className="text-gray-400 text-sm text-center py-8">Нет задач</div>}
      </div>
    </div>
  );
}
