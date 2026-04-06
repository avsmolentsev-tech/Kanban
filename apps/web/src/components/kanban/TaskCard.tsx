import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task, Project } from '@pis/shared';
import { Badge } from '../ui/Badge';

interface TaskCardProps { task: Task; project?: Project; onClick: () => void; }

export function TaskCard({ task, project, onClick }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const overdue = task.due_date ? new Date(task.due_date) < new Date() : false;

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} onClick={onClick}
      className="bg-white rounded-lg border border-gray-200 p-3 cursor-pointer hover:border-indigo-300 hover:shadow-sm transition-all">
      <div className="text-sm font-medium text-gray-800 mb-2">{task.title}</div>
      <div className="flex flex-wrap gap-1 items-center">
        {project && <Badge label={project.name} color={project.color} />}
        <span className={`text-xs px-1.5 py-0.5 rounded ${task.priority >= 4 ? 'bg-red-100 text-red-700' : task.priority === 3 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'}`}>
          P{task.priority}
        </span>
        {task.due_date && <span className={`text-xs ${overdue ? 'text-red-500 font-medium' : 'text-gray-400'}`}>{task.due_date}</span>}
      </div>
    </div>
  );
}
