import { useDroppable } from '@dnd-kit/core';
import type { Task, Project } from '@pis/shared';
import { TaskCard } from '../kanban/TaskCard';

export type TimePeriod = 'today' | 'week' | 'month' | 'year';

interface Props {
  tasks: Task[];
  projects: Project[];
  period: TimePeriod;
  onTaskClick: (t: Task) => void;
}

function isInPeriod(dueDate: string | null, period: TimePeriod): boolean {
  if (!dueDate) return false;
  const due = new Date(dueDate);
  const now = new Date();
  switch (period) {
    case 'today': return due.toDateString() === now.toDateString();
    case 'week': { const end = new Date(now); end.setDate(now.getDate() + (6 - now.getDay())); return due >= new Date(now.toDateString()) && due <= end; }
    case 'month': return due.getMonth() === now.getMonth() && due.getFullYear() === now.getFullYear();
    case 'year': return due.getFullYear() === now.getFullYear();
  }
}

function DroppableZone({ id, children, label }: { id: string; children: React.ReactNode; label: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`min-h-[100px] rounded-xl p-3 transition-colors ${isOver ? 'bg-indigo-50 border-2 border-dashed border-indigo-300' : 'bg-gray-50'}`}>
      <h3 className="text-sm font-semibold text-gray-500 mb-3">{label}</h3>
      {children}
    </div>
  );
}

export function TimelineView({ tasks, projects, period, onTaskClick }: Props) {
  const pMap = new Map(projects.map((p) => [p.id, p]));
  const filtered = tasks.filter((t) => isInPeriod(t.due_date, period) && !t.archived);
  const noDue = tasks.filter((t) => !t.due_date && !t.archived);

  return (
    <div className="p-4 space-y-4">
      <DroppableZone id={`timeline-${period}`} label={`${filtered.length} task${filtered.length !== 1 ? 's' : ''}`}>
        {filtered.length === 0 && <div className="text-gray-400 text-sm text-center py-4">Drop tasks here</div>}
        <div className="space-y-2 max-w-md">
          {filtered.map((t) => <TaskCard key={t.id} task={t} project={t.project_id ? pMap.get(t.project_id) : undefined} onClick={() => onTaskClick(t)} />)}
        </div>
      </DroppableZone>

      {noDue.length > 0 && (
        <DroppableZone id="timeline-unscheduled" label={`No due date (${noDue.length})`}>
          <div className="space-y-2 max-w-md opacity-60">
            {noDue.map((t) => <TaskCard key={t.id} task={t} project={t.project_id ? pMap.get(t.project_id) : undefined} onClick={() => onTaskClick(t)} />)}
          </div>
        </DroppableZone>
      )}
    </div>
  );
}
