import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Task, Project, TaskStatus } from '@pis/shared';
import { TaskCard } from './TaskCard';

const LABELS: Record<TaskStatus, string> = { backlog: 'Backlog', todo: 'To Do', in_progress: 'In Progress', done: 'Done' };

interface Props { status: TaskStatus; tasks: Task[]; projects: Project[]; onTaskClick: (t: Task) => void; onAddTask: (s: TaskStatus) => void; }

export function KanbanColumn({ status, tasks, projects, onTaskClick, onAddTask }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const pMap = new Map(projects.map((p) => [p.id, p]));

  return (
    <div ref={setNodeRef} className={`flex flex-col w-64 min-w-[256px] bg-gray-100 rounded-xl p-3 transition-colors ${isOver ? 'bg-indigo-50' : ''}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">{LABELS[status]} <span className="ml-2 text-xs text-gray-400 font-normal">{tasks.length}</span></h3>
        <button onClick={() => onAddTask(status)} className="text-gray-400 hover:text-indigo-600 text-lg leading-none" title="Add task">+</button>
      </div>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2 flex-1 min-h-[100px]">
          {tasks.map((t) => <TaskCard key={t.id} task={t} project={t.project_id ? pMap.get(t.project_id) : undefined} onClick={() => onTaskClick(t)} />)}
        </div>
      </SortableContext>
    </div>
  );
}
