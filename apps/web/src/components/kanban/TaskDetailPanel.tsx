import { SlidePanel } from '../ui/SlidePanel';
import { Badge } from '../ui/Badge';
import type { Task, Project } from '@pis/shared';

interface Props { task: Task | null; project?: Project; onClose: () => void; }

export function TaskDetailPanel({ task, project, onClose }: Props) {
  return (
    <SlidePanel open={!!task} onClose={onClose} title={task?.title ?? ''}>
      {task && (
        <div className="space-y-4">
          {project && <div><div className="text-xs text-gray-500 mb-1">Project</div><Badge label={project.name} color={project.color} /></div>}
          <div className="grid grid-cols-2 gap-3">
            <div><div className="text-xs text-gray-500">Status</div><div className="text-sm font-medium capitalize">{task.status.replace('_', ' ')}</div></div>
            <div><div className="text-xs text-gray-500">Priority</div><div className="text-sm font-medium">{task.priority}/5</div></div>
            <div><div className="text-xs text-gray-500">Urgency</div><div className="text-sm font-medium">{task.urgency}/5</div></div>
            {task.due_date && <div><div className="text-xs text-gray-500">Due</div><div className="text-sm font-medium">{task.due_date}</div></div>}
          </div>
          {task.description && <div><div className="text-xs text-gray-500 mb-1">Description</div><div className="text-sm text-gray-700 whitespace-pre-wrap">{task.description}</div></div>}
          <div className="text-xs text-gray-400">Created: {task.created_at}</div>
        </div>
      )}
    </SlidePanel>
  );
}
