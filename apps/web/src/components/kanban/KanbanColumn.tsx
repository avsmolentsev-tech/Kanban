import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Task, Project, TaskStatus } from '@pis/shared';
import { TaskCard } from './TaskCard';

interface Props {
  status: TaskStatus;
  droppableId?: string;
  tasks: Task[];
  projects: Project[];
  onTaskClick: (t: Task) => void;
  onAddTask: (s: TaskStatus) => void;
  hideHeader?: boolean;
}

export function KanbanColumn({ status, droppableId, tasks, projects, onTaskClick, onAddTask, hideHeader }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: droppableId ?? status });
  const pMap = new Map(projects.map((p) => [p.id, p]));

  return (
    <div ref={setNodeRef} className={`flex flex-col w-64 min-w-[256px] bg-gray-100 rounded-xl p-3 transition-colors ${isOver ? 'bg-indigo-50' : ''}`}>
      {!hideHeader && (
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">
            {status.replace('_', ' ')} <span className="ml-2 text-xs text-gray-400 font-normal">{tasks.length}</span>
          </h3>
          <button onClick={() => onAddTask(status)} className="text-gray-400 hover:text-indigo-600 text-lg leading-none" title="Add task">+</button>
        </div>
      )}
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2 flex-1 min-h-[60px]">
          {tasks.map((t) => <TaskCard key={t.id} task={t} project={t.project_id ? pMap.get(t.project_id) : undefined} onClick={() => onTaskClick(t)} onToggleDone={() => {}} />)}
        </div>
      </SortableContext>
    </div>
  );
}
