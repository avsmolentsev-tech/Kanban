import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
// Timeline uses dragMode="draggable" on TaskCards (not sortable) so cards can move between columns
import { CSS } from '@dnd-kit/utilities';
import type { Task, Project, Person } from '@pis/shared';
import { TaskCard } from '../kanban/TaskCard';
import { AddTaskModal } from '../kanban/AddTaskModal';

export type TimePeriod = 'today' | 'week' | 'month' | 'year';

export { classifyTask };

const PERIOD_LABELS: Record<TimePeriod, string> = {
  today: 'Today',
  week: 'This Week',
  month: 'This Month',
  year: 'This Year',
};

const PERIODS: TimePeriod[] = ['today', 'week', 'month', 'year'];

function classifyTask(dueDate: string | null): TimePeriod | 'none' {
  if (!dueDate) return 'none';
  const due = new Date(dueDate);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);

  // Today
  if (due >= today && due < tomorrow) return 'today';

  // This week (rest of the week after today)
  const endOfWeek = new Date(today);
  endOfWeek.setDate(today.getDate() + (7 - today.getDay()));
  if (due >= tomorrow && due < endOfWeek) return 'week';

  // This month (rest of month after this week)
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  if (due >= endOfWeek && due <= endOfMonth) return 'month';

  // This year
  if (due.getFullYear() === now.getFullYear() && due > endOfMonth) return 'year';

  // Past or future years — put in closest bucket
  if (due < today) return 'today'; // overdue goes to today
  return 'year';
}

function computePeriodDueDate(period: TimePeriod): string {
  const now = new Date();
  switch (period) {
    case 'today': return now.toISOString().split('T')[0]!;
    case 'week': { const fri = new Date(now); fri.setDate(now.getDate() + (5 - now.getDay())); return fri.toISOString().split('T')[0]!; }
    case 'month': { const end = new Date(now.getFullYear(), now.getMonth() + 1, 0); return end.toISOString().split('T')[0]!; }
    case 'year': return `${now.getFullYear()}-12-31`;
  }
}

function TimelineColumn({ period, tasks, projects, onTaskClick, onToggleDone, projectId, people, onRefresh, dueDate }: {
  period: TimePeriod | 'none' | 'done'; tasks: Task[]; projects: Project[]; onTaskClick: (t: Task) => void;
  onToggleDone: (id: number, newStatus: import('@pis/shared').TaskStatus) => void;
  projectId: number | null; people: Person[]; onRefresh: () => void; dueDate?: string | null;
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
        {tasks.length === 0 && !adding && <div className="text-gray-300 text-xs text-center py-4">Drop here</div>}
      </div>
      {adding ? (
        <div className="mt-2">
          <AddTaskModal status="todo" projectId={projectId} people={people} dueDate={dueDate}
            onCreated={() => { setAdding(false); onRefresh(); }} onCancel={() => setAdding(false)} />
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="mt-2 text-xs text-gray-400 hover:text-indigo-600 transition-colors self-center">+ Add</button>
      )}
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
    <div className="p-4 overflow-auto">
      {/* Column headers */}
      <div className="flex mb-2 ml-44">
        {PERIODS.map((p) => (
          <div key={p} className="w-64 min-w-[256px] mx-2 text-sm font-semibold text-gray-500 text-center">
            {PERIOD_LABELS[p]}
          </div>
        ))}
        <div className="w-64 min-w-[256px] mx-2 text-sm font-semibold text-gray-400 text-center">No due date</div>
        <div className="w-64 min-w-[256px] mx-2 text-sm font-semibold text-green-600 text-center">Done</div>
      </div>

      {/* Project swimlanes */}
      <SortableContext items={projectOrder.map((p) => `project-row-${p.project?.id ?? 'none'}`)} strategy={verticalListSortingStrategy}>
        {projectOrder.map(({ project, tasks: pTasks }) => {
          const grouped: Record<TimePeriod | 'none' | 'done', Task[]> = { today: [], week: [], month: [], year: [], none: [], done: [] };
          for (const t of pTasks) {
            if (t.status === 'done') {
              grouped.done.push(t);
            } else {
              grouped[classifyTask(t.due_date)].push(t);
            }
          }

          return (
            <SortableProjectRow key={project?.id ?? 'none'} id={`project-row-${project?.id ?? 'none'}`}>
              {(dragHandleProps) => (
                <div className="flex mb-4">
                  {/* Project label */}
                  <div className="w-40 min-w-[160px] flex-shrink-0 pr-3 pt-3">
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
                      <span className="text-sm font-semibold text-gray-700 truncate">{project?.name ?? 'No project'}</span>
                    </div>
                    <div className="text-xs text-gray-400 mt-1 ml-5">{pTasks.length} task{pTasks.length !== 1 ? 's' : ''}</div>
                  </div>

                  {/* Period columns */}
                  <div className="flex gap-4">
                    {PERIODS.map((period) => (
                      <TimelineColumn key={`${project?.id ?? 'none'}-${period}`} period={period} tasks={grouped[period]} projects={projects}
                        onTaskClick={onTaskClick} onToggleDone={onToggleDone} projectId={project?.id ?? null} people={people} onRefresh={onRefresh}
                        dueDate={computePeriodDueDate(period)} />
                    ))}
                    <TimelineColumn period="none" tasks={grouped.none} projects={projects} onTaskClick={onTaskClick}
                      onToggleDone={onToggleDone} projectId={project?.id ?? null} people={people} onRefresh={onRefresh} dueDate={null} />
                    <TimelineColumn period="done" tasks={grouped.done} projects={projects} onTaskClick={onTaskClick}
                      onToggleDone={onToggleDone} projectId={project?.id ?? null} people={people} onRefresh={onRefresh} dueDate={null} />
                  </div>
                </div>
              )}
            </SortableProjectRow>
          );
        })}
      </SortableContext>

      {projectOrder.length === 0 && <div className="text-gray-400 text-sm text-center py-8">No tasks yet</div>}
    </div>
  );
}
