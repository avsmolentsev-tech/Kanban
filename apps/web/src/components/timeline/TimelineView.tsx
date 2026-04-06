import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Task, Project } from '@pis/shared';
import { TaskCard } from '../kanban/TaskCard';

export type TimePeriod = 'today' | 'week' | 'month' | 'year';

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
}

export function TimelineView({ tasks, projects, onTaskClick }: Props) {
  const activeTasks = tasks.filter((t) => !t.archived);

  const grouped: Record<TimePeriod | 'none', Task[]> = { today: [], week: [], month: [], year: [], none: [] };
  for (const t of activeTasks) {
    const bucket = classifyTask(t.due_date);
    grouped[bucket].push(t);
  }

  return (
    <div className="flex gap-4 p-4 overflow-x-auto">
      {PERIODS.map((p) => (
        <TimelineColumn key={p} period={p} tasks={grouped[p]} projects={projects} onTaskClick={onTaskClick} />
      ))}
      <TimelineColumn period="none" tasks={grouped.none} projects={projects} onTaskClick={onTaskClick} />
    </div>
  );
}
