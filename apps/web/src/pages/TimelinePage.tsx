import { useEffect, useState } from 'react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { useTasksStore, useProjectsStore } from '../store';
import { tasksApi } from '../api/tasks.api';
import { peopleApi } from '../api/people.api';
import { TimelineView, type TimePeriod, classifyTask } from '../components/timeline/TimelineView';
import { TaskDetailPanel } from '../components/kanban/TaskDetailPanel';
import type { Task, Person } from '@pis/shared';

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
  const { projects, fetchProjects, reorderProjects } = useProjectsStore();
  const [selected, setSelected] = useState<Task | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const pMap = new Map(projects.map((p) => [p.id, p]));

  useEffect(() => { fetchTasks(); fetchProjects(); peopleApi.list().then(setPeople); }, [fetchTasks, fetchProjects]);

  const handleMoveProject = (projectId: number | null, direction: 'up' | 'down') => {
    if (projectId === null) return;
    const idx = projects.findIndex((p) => p.id === projectId);
    if (idx === -1) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= projects.length) return;
    const items = projects.map((p, i) => ({ id: p.id, order_index: i }));
    const tmp = items[idx]!.order_index;
    items[idx]!.order_index = items[swapIdx]!.order_index;
    items[swapIdx]!.order_index = tmp;
    reorderProjects(items);
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;
    const overId = String(over.id);
    const taskId = Number(active.id);

    let target: TimePeriod | 'none' | null = null;

    if (overId.startsWith('timeline-')) {
      // Dropped on a column
      target = overId.replace('timeline-', '') as TimePeriod | 'none';
    } else {
      // Dropped on another task — find which column that task is in
      const overTask = tasks.find((t) => t.id === Number(overId));
      if (overTask) {
        target = classifyTask(overTask.due_date);
      }
    }

    if (target !== null) {
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
          <TimelineView tasks={tasks} projects={projects} people={people} onTaskClick={setSelected} onMoveProject={handleMoveProject} onRefresh={() => fetchTasks()} />
        </DndContext>
      </div>
      <TaskDetailPanel task={selected} project={selected?.project_id ? pMap.get(selected.project_id) : undefined} onClose={() => setSelected(null)} />
    </div>
  );
}
