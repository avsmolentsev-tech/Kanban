import { useState } from 'react';
import { SlidePanel } from '../ui/SlidePanel';
import { Badge } from '../ui/Badge';
import type { Task, Project, Person } from '@pis/shared';
import { tasksApi } from '../../api/tasks.api';

interface Props { task: Task | null; project?: Project; people: Person[]; onClose: () => void; onUpdated: () => void; }

export function TaskDetailPanel({ task, project, people, onClose, onUpdated }: Props) {
  const [saving, setSaving] = useState(false);

  const assignedIds = new Set((task?.people ?? []).map((p) => p.id));

  const togglePerson = async (personId: number) => {
    if (!task) return;
    setSaving(true);
    try {
      const next = assignedIds.has(personId)
        ? [...assignedIds].filter((id) => id !== personId)
        : [...assignedIds, personId];
      await tasksApi.update(task.id, { person_ids: next });
      onUpdated();
    } finally {
      setSaving(false);
    }
  };

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

          {people.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-2">Assignees</div>
              <div className="flex flex-wrap gap-2">
                {people.map((p) => {
                  const assigned = assignedIds.has(p.id);
                  return (
                    <button key={p.id} onClick={() => togglePerson(p.id)} disabled={saving}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs border transition-colors ${assigned ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'}`}>
                      <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${assigned ? 'bg-indigo-400' : 'bg-gray-200'}`}>
                        {p.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)}
                      </span>
                      {p.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="text-xs text-gray-400">Created: {task.created_at}</div>
        </div>
      )}
    </SlidePanel>
  );
}
