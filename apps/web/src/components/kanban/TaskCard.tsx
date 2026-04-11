import { useState, useCallback } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { Task, Project, TaskStatus } from '@pis/shared';
import { Badge } from '../ui/Badge';
import { apiClient } from '../../api/client';

interface TaskCardProps {
  task: Task;
  project?: Project;
  onClick: () => void;
  onToggleDone: (id: number, newStatus: TaskStatus) => void;
  dragMode?: 'sortable' | 'draggable';
}

function initials(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

function useDragProps(id: number, mode: 'sortable' | 'draggable') {
  const sortable = useSortable({ id, disabled: mode !== 'sortable' });
  const draggable = useDraggable({ id, disabled: mode !== 'draggable' });

  if (mode === 'draggable') {
    return {
      setNodeRef: draggable.setNodeRef,
      attributes: draggable.attributes,
      listeners: draggable.listeners,
      transform: draggable.transform,
      transition: undefined,
      isDragging: draggable.isDragging,
    };
  }
  return {
    setNodeRef: sortable.setNodeRef,
    attributes: sortable.attributes,
    listeners: sortable.listeners,
    transform: sortable.transform,
    transition: sortable.transition,
    isDragging: sortable.isDragging,
  };
}

export function TaskCard({ task, project, onClick, onToggleDone, dragMode = 'sortable' }: TaskCardProps) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useDragProps(task.id, dragMode);
  const [fileDragOver, setFileDragOver] = useState(false);
  const [uploadFeedback, setUploadFeedback] = useState<string | null>(null);

  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const overdue = task.due_date ? new Date(task.due_date) < new Date() : false;

  const handleFileDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.stopPropagation();
      setFileDragOver(true);
    }
  }, []);

  const handleFileDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setFileDragOver(false);
  }, []);

  const handleFileDrop = useCallback(async (e: React.DragEvent) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    e.stopPropagation();
    setFileDragOver(false);
    const file = e.dataTransfer.files[0]!;
    const formData = new FormData();
    formData.append('file', file);
    try {
      await apiClient.post(`/tasks/${task.id}/attachments`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setUploadFeedback('\u{1F4CE} Загружено');
      setTimeout(() => setUploadFeedback(null), 2000);
    } catch {
      setUploadFeedback('\u274C Ошибка');
      setTimeout(() => setUploadFeedback(null), 2000);
    }
  }, [task.id]);

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} onClick={onClick}
      onDragOver={handleFileDragOver}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
      className={`rounded-lg border p-3 cursor-pointer hover:shadow-sm transition-all ${fileDragOver ? 'border-blue-400 border-2 bg-blue-50' : task.status === 'done' ? 'bg-green-50 border-green-300 hover:border-green-400' : 'bg-white border-gray-200 hover:border-indigo-300'}`}>
      <div className="flex items-start gap-2 mb-2">
        <input
          type="checkbox"
          checked={task.status === 'done'}
          onClick={(e) => { e.stopPropagation(); onToggleDone(task.id, task.status === 'done' ? 'todo' : 'done'); }}
          onChange={() => {}}
          className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 cursor-pointer flex-shrink-0 mt-0.5"
        />
        <div className="text-sm font-medium text-gray-800">{task.title}</div>
      </div>
      {/* Tags */}
      {task.tags && task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {task.tags.map((tag) => (
            <span key={tag.id} className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: tag.color }} title={tag.name} />
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1 items-center">
        {project && <Badge label={project.name} color={project.color} />}
        <span className={`text-xs px-1.5 py-0.5 rounded ${task.priority >= 4 ? 'bg-red-100 text-red-700' : task.priority === 3 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'}`}>
          P{task.priority}
        </span>
        {task.due_date && <span className={`text-xs ${overdue ? 'text-red-500 font-medium' : 'text-gray-400'}`}>{task.due_date}</span>}
        {task.people && task.people.length > 0 && (
          <div className="flex -space-x-1 ml-auto">
            {task.people.slice(0, 3).map((p) => (
              <div key={p.id} title={p.name}
                className="w-5 h-5 rounded-full bg-indigo-500 text-white text-[9px] font-bold flex items-center justify-center ring-1 ring-white">
                {initials(p.name)}
              </div>
            ))}
          </div>
        )}
      </div>
      {uploadFeedback && (
        <div className="mt-1.5 text-xs text-center text-indigo-600 font-medium animate-pulse">{uploadFeedback}</div>
      )}
    </div>
  );
}
