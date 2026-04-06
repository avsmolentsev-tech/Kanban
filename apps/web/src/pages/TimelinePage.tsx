import { useEffect, useState } from 'react';
import { DndContext, pointerWithin, type DragEndEvent, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { useTasksStore, useProjectsStore } from '../store';
import { tasksApi } from '../api/tasks.api';
import { peopleApi } from '../api/people.api';
import { TimelineView, type TimePeriod, classifyTask } from '../components/timeline/TimelineView';
import { TaskDetailPanel } from '../components/kanban/TaskDetailPanel';
import type { Task, Person, TaskStatus } from '@pis/shared';

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

  // Require 8px movement before drag starts — so checkbox clicks work
  const mouseSensor = useSensor(MouseSensor, { activationConstraint: { distance: 8 } });
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } });
  const sensors = useSensors(mouseSensor, touchSensor);

  useEffect(() => { fetchTasks(); fetchProjects(); peopleApi.list().then(setPeople); }, [fetchTasks, fetchProjects]);

  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    if (activeId.startsWith('project-row-')) {
      if (!overId.startsWith('project-row-')) return;
      const fromIdx = projects.findIndex((p) => `project-row-${p.id}` === activeId);
      const toIdx = projects.findIndex((p) => `project-row-${p.id}` === overId);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
      const reordered = arrayMove(projects, fromIdx, toIdx);
      const items = reordered.map((p, i) => ({ id: p.id, order_index: i }));
      reorderProjects(items);
    } else {
      const taskId = Number(activeId);
      let target: TimePeriod | 'none' | 'done' | null = null;

      if (overId.startsWith('timeline-')) {
        target = overId.replace('timeline-', '') as TimePeriod | 'none' | 'done';
      } else {
        const overTask = tasks.find((t) => t.id === Number(overId));
        if (overTask) {
          target = overTask.status === 'done' ? 'done' : classifyTask(overTask.due_date);
        }
      }

      if (target === 'done') {
        await tasksApi.update(taskId, { status: 'done' });
        await fetchTasks();
      } else if (target !== null) {
        // If moving out of done, set back to todo
        const task = tasks.find((t) => t.id === taskId);
        const updates: Record<string, unknown> = { due_date: computeDueDate(target) };
        if (task?.status === 'done') updates.status = 'todo';
        await tasksApi.update(taskId, updates);
        await fetchTasks();
      }
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 bg-white border-b">
        <h1 className="text-xl font-bold text-gray-800">Timeline</h1>
      </div>
      <div className="flex-1 overflow-auto">
        <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={handleDragEnd}>
          <TimelineView
            tasks={tasks}
            projects={projects}
            people={people}
            onTaskClick={setSelected}
            onToggleDone={async (id: number, newStatus: TaskStatus) => { await tasksApi.update(id, { status: newStatus }); await fetchTasks(); }}
            onReorderProjects={reorderProjects}
            onRefresh={() => fetchTasks()}
          />
        </DndContext>
      </div>
      <TaskDetailPanel task={selected} projects={projects} people={people} onClose={() => setSelected(null)} onUpdated={() => fetchTasks()} />
    </div>
  );
}
