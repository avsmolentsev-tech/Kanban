import type { Task, Project } from '@pis/shared';
import { TaskCard } from '../kanban/TaskCard';

export type TimePeriod = 'today' | 'week' | 'month' | 'year';

interface Props { tasks: Task[]; projects: Project[]; period: TimePeriod; onTaskClick: (t: Task) => void; }

function isInPeriod(dueDate: string | null, period: TimePeriod): boolean {
  if (!dueDate) return false;
  const due = new Date(dueDate);
  const now = new Date();
  switch (period) {
    case 'today': return due.toDateString() === now.toDateString();
    case 'week': { const end = new Date(now); end.setDate(now.getDate() + (6 - now.getDay())); return due >= now && due <= end; }
    case 'month': return due.getMonth() === now.getMonth() && due.getFullYear() === now.getFullYear();
    case 'year': return due.getFullYear() === now.getFullYear();
  }
}

export function TimelineView({ tasks, projects, period, onTaskClick }: Props) {
  const pMap = new Map(projects.map((p) => [p.id, p]));
  const filtered = tasks.filter((t) => isInPeriod(t.due_date, period) && !t.archived);
  const noDue = tasks.filter((t) => !t.due_date && !t.archived);

  return (
    <div className="p-4 space-y-6">
      {filtered.length === 0 && noDue.length === 0 && <div className="text-gray-400 text-sm text-center py-8">No tasks</div>}
      {filtered.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-500 mb-3">{filtered.length} task{filtered.length !== 1 ? 's' : ''}</h3>
          <div className="space-y-2 max-w-sm">
            {filtered.map((t) => <TaskCard key={t.id} task={t} project={t.project_id ? pMap.get(t.project_id) : undefined} onClick={() => onTaskClick(t)} />)}
          </div>
        </div>
      )}
      {noDue.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-400 mb-3">No due date ({noDue.length})</h3>
          <div className="space-y-2 max-w-sm opacity-60">
            {noDue.map((t) => <TaskCard key={t.id} task={t} project={t.project_id ? pMap.get(t.project_id) : undefined} onClick={() => onTaskClick(t)} />)}
          </div>
        </div>
      )}
    </div>
  );
}
