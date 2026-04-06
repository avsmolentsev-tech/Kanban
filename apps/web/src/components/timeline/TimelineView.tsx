import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Task, Project } from '@pis/shared';
import { TaskCard } from '../kanban/TaskCard';

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

function TimelineColumn({ period, tasks, projects, onTaskClick }: {
  period: TimePeriod | 'none'; tasks: Task[]; projects: Project[]; onTaskClick: (t: Task) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `timeline-${period}` });
  const pMap = new Map(projects.map((p) => [p.id, p]));
  const label = period === 'none' ? 'No due date' : PERIOD_LABELS[period];

  return (
    <div ref={setNodeRef}
      className={`flex flex-col w-64 min-w-[256px] bg-gray-100 rounded-xl p-3 transition-colors ${isOver ? 'bg-indigo-50' : ''}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">
          {label}
          <span className="ml-2 text-xs text-gray-400 font-normal">{tasks.length}</span>
        </h3>
      </div>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2 flex-1 min-h-[100px]">
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} project={t.project_id ? pMap.get(t.project_id) : undefined} onClick={() => onTaskClick(t)} />
          ))}
          {tasks.length === 0 && <div className="text-gray-300 text-xs text-center py-4">Drop here</div>}
        </div>
      </SortableContext>
    </div>
  );
}

interface Props {
  tasks: Task[];
  projects: Project[];
  onTaskClick: (t: Task) => void;
  onMoveProject: (projectId: number | null, direction: 'up' | 'down') => void;
}

export function TimelineView({ tasks, projects, onTaskClick, onMoveProject }: Props) {
  const activeTasks = tasks.filter((t) => !t.archived);

  // Group by project, then by period
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
      </div>

      {/* Project swimlanes */}
      {projectOrder.map(({ project, tasks: pTasks }) => {
        const grouped: Record<TimePeriod | 'none', Task[]> = { today: [], week: [], month: [], year: [], none: [] };
        for (const t of pTasks) {
          grouped[classifyTask(t.due_date)].push(t);
        }

        return (
          <div key={project?.id ?? 'none'} className="flex mb-4">
            {/* Project label */}
            <div className="w-40 min-w-[160px] flex-shrink-0 pr-3 pt-3">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: project?.color ?? '#9ca3af' }} />
                <span className="text-sm font-semibold text-gray-700 truncate">{project?.name ?? 'No project'}</span>
                {project && (
                  <div className="flex gap-0.5 ml-auto">
                    <button onClick={() => onMoveProject(project.id, 'up')} className="text-gray-300 hover:text-gray-600 text-xs leading-none">▲</button>
                    <button onClick={() => onMoveProject(project.id, 'down')} className="text-gray-300 hover:text-gray-600 text-xs leading-none">▼</button>
                  </div>
                )}
              </div>
              <div className="text-xs text-gray-400 mt-1 ml-5">{pTasks.length} task{pTasks.length !== 1 ? 's' : ''}</div>
            </div>

            {/* Period columns */}
            <div className="flex gap-4">
              {PERIODS.map((period) => (
                <TimelineColumn key={`${project?.id ?? 'none'}-${period}`} period={period} tasks={grouped[period]} projects={projects} onTaskClick={onTaskClick} />
              ))}
              <TimelineColumn period="none" tasks={grouped.none} projects={projects} onTaskClick={onTaskClick} />
            </div>
          </div>
        );
      })}

      {projectOrder.length === 0 && <div className="text-gray-400 text-sm text-center py-8">No tasks yet</div>}
    </div>
  );
}
