import { useState, useCallback } from 'react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import type { Task, Project, TaskStatus } from '@pis/shared';
import { KanbanColumn } from './KanbanColumn';
import { TaskDetailPanel } from './TaskDetailPanel';

const COLUMNS: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'done'];

interface Props { tasks: Task[]; projects: Project[]; onMoveTask: (id: number, status: TaskStatus, idx: number) => Promise<void>; onAddTask: (s: TaskStatus) => void; }

export function KanbanBoard({ tasks, projects, onMoveTask, onAddTask }: Props) {
  const [selected, setSelected] = useState<Task | null>(null);
  const pMap = new Map(projects.map((p) => [p.id, p]));
  const byStatus = useCallback((s: TaskStatus) => tasks.filter((t) => t.status === s), [tasks]);

  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;
    const newStatus = over.id as TaskStatus;
    if (COLUMNS.includes(newStatus)) {
      await onMoveTask(Number(active.id), newStatus, byStatus(newStatus).length);
    }
  };

  return (
    <>
      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 p-4 overflow-x-auto">
          {COLUMNS.map((s) => <KanbanColumn key={s} status={s} tasks={byStatus(s)} projects={projects} onTaskClick={setSelected} onAddTask={onAddTask} />)}
        </div>
      </DndContext>
      <TaskDetailPanel task={selected} project={selected?.project_id ? pMap.get(selected.project_id) : undefined} onClose={() => setSelected(null)} />
    </>
  );
}
