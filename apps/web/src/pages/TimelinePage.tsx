import { useEffect, useState } from 'react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { useTasksStore, useProjectsStore } from '../store';
import { tasksApi } from '../api/tasks.api';
import { TimelineView, type TimePeriod } from '../components/timeline/TimelineView';
import { TaskDetailPanel } from '../components/kanban/TaskDetailPanel';
import type { Task } from '@pis/shared';

function computeDueDate(period: TimePeriod | 'none'): string | null {
  if (period === 'none') return null;
  const now = new Date();
  switch (period) {
    case 'today':
      return now.toISOString().split('T')[0]!;
    case 'week': {
      const fri = new Date(now);
      fri.setDate(now.getDate() + (5 - now.getDay()));
      if (fri <= now) fri.setDate(fri.getDate() + 7);
      return fri.toISOString().split('T')[0]!;
    }
    case 'month': {
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return end.toISOString().split('T')[0]!;
    }
    case 'year':
      return `${now.getFullYear()}-12-31`;
  }
}

export function TimelinePage() {
  const { tasks, fetchTasks } = useTasksStore();
  const { projects, fetchProjects } = useProjectsStore();
  const [selected, setSelected] = useState<Task | null>(null);
  const pMap = new Map(projects.map((p) => [p.id, p]));

  useEffect(() => { fetchTasks(); fetchProjects(); }, [fetchTasks, fetchProjects]);

  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;
    const overId = String(over.id);
    if (overId.startsWith('timeline-')) {
      const target = overId.replace('timeline-', '') as TimePeriod | 'none';
      const taskId = Number(active.id);
      const newDue = computeDueDate(target);
      await tasksApi.update(taskId, { due_date: newDue });
      await fetchTasks();
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 bg-white border-b">
        <h1 className="text-xl font-bold text-gray-800">Timeline</h1>
      </div>
      <div className="flex-1 overflow-auto">
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <TimelineView tasks={tasks} projects={projects} onTaskClick={setSelected} />
        </DndContext>
      </div>
      <TaskDetailPanel task={selected} project={selected?.project_id ? pMap.get(selected.project_id) : undefined} onClose={() => setSelected(null)} />
    </div>
  );
}
