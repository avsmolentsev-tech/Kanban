import { useState, useCallback, useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Trash2, Check } from 'lucide-react';
import type { Task, Project, TaskStatus } from '@pis/shared';
import { Badge } from '../ui/Badge';
import { apiClient } from '../../api/client';
import { tasksApi } from '../../api/tasks.api';
import { useTasksStore } from '../../store';

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

  // Swipe-to-action (touch): left → delete, right → done. Coexists with drag,
  // which is delay-activated (long-press) via the board sensors.
  const [swipeX, setSwipeX] = useState(0);
  const swipe = useRef<{ start: { x: number; y: number } | null; horizontal: boolean }>({ start: null, horizontal: false });

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]!; swipe.current.start = { x: t.clientX, y: t.clientY }; swipe.current.horizontal = false;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = swipe.current; if (!s.start) return;
    const t = e.touches[0]!; const dx = t.clientX - s.start.x; const dy = t.clientY - s.start.y;
    if (!s.horizontal) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) s.horizontal = true;
      else if (Math.abs(dy) > 10) { s.start = null; return; }
    }
    if (s.horizontal) { e.stopPropagation(); setSwipeX(Math.max(-140, Math.min(140, dx))); }
  };
  const onTouchEnd = async () => {
    const x = swipeX; swipe.current.start = null; swipe.current.horizontal = false;
    if (x < -80) {
      if (confirm('Удалить задачу?')) {
        setSwipeX(-500);
        try { await tasksApi.delete(task.id); await useTasksStore.getState().fetchTasks(); } catch { setSwipeX(0); }
      } else setSwipeX(0);
    } else if (x > 80) {
      onToggleDone(task.id, task.status === 'done' ? 'todo' : 'done');
      setSwipeX(0);
    } else setSwipeX(0);
  };

  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const today = new Date().toISOString().slice(0, 10);
  const overdue = task.due_date ? task.due_date < today : false;

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
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
      className="relative overflow-hidden rounded-lg">
      {/* Swipe reveal backgrounds */}
      <div className="absolute inset-0 flex items-center justify-between px-4 pointer-events-none">
        <span className={`flex items-center gap-1 text-green-600 text-xs font-semibold transition-opacity ${swipeX > 20 ? 'opacity-100' : 'opacity-0'}`}><Check size={16} /> Готово</span>
        <span className={`flex items-center gap-1 text-red-600 text-xs font-semibold transition-opacity ${swipeX < -20 ? 'opacity-100' : 'opacity-0'}`}>Удалить <Trash2 size={16} /></span>
      </div>
      {/* Card content (translated during swipe) */}
      <div onClick={() => { if (Math.abs(swipeX) < 5) onClick(); }}
        onDragOver={handleFileDragOver}
        onDragLeave={handleFileDragLeave}
        onDrop={handleFileDrop}
        style={{ transform: `translateX(${swipeX}px)`, transition: swipe.current.start ? 'none' : 'transform 0.2s ease' }}
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
        {task.revenue_impact && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-semibold">${task.revenue_impact >= 1000 ? `${task.revenue_impact / 1000}K` : task.revenue_impact}</span>}
        {task.due_date && overdue && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-semibold uppercase">Просрочено</span>}
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
    </div>
  );
}
