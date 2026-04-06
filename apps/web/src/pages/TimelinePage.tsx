import { useEffect, useState } from 'react';
import { DndContext, rectIntersection, type DragEndEvent, type DragStartEvent, MouseSensor, TouchSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { useTasksStore, useProjectsStore, useFiltersStore } from '../store';
import { tasksApi } from '../api/tasks.api';
import { peopleApi } from '../api/people.api';
import { TimelineView, type TimePeriod, classifyTask } from '../components/timeline/TimelineView';
import { TaskDetailPanel } from '../components/kanban/TaskDetailPanel';
import { ProjectFilter } from '../components/filters/ProjectFilter';
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
  const { selectedProjectIds } = useFiltersStore();
  const pMap = new Map(projects.map((p) => [p.id, p]));

  const mouseSensor = useSensor(MouseSensor, { activationConstraint: { distance: 3 } });
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } });
  const sensors = useSensors(mouseSensor, touchSensor);
  const [draggingTask, setDraggingTask] = useState<Task | null>(null);

  useEffect(() => { fetchTasks(); fetchProjects(); peopleApi.list().then(setPeople); }, [fetchTasks, fetchProjects]);

  const handleDragStart = (e: DragStartEvent) => {
    const id = Number(e.active.id);
    setDraggingTask(tasks.find((t) => t.id === id) ?? null);
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    setDraggingTask(null);
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
        // Format: timeline-{projectId}-{period}
        const parts = overId.split('-');
        target = parts[parts.length - 1] as TimePeriod | 'none' | 'done';
        // Extract target project ID for cross-project moves
        const targetProjectPart = parts.slice(1, -1).join('-'); // e.g. "1", "none"
        const targetProjectId = targetProjectPart === 'none' ? null : Number(targetProjectPart);
        const task = tasks.find((t) => t.id === taskId);
        if (task && task.project_id !== targetProjectId) {
          // Moving to a different project
          if (target === 'done') {
            await tasksApi.update(taskId, { status: 'done', project_id: targetProjectId });
          } else {
            const updates: Record<string, unknown> = { due_date: computeDueDate(target), project_id: targetProjectId };
            if (task.status === 'done') updates.status = 'todo';
            await tasksApi.update(taskId, updates);
          }
          await fetchTasks();
          return;
        }
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
      <div className="flex items-center justify-between px-4 pt-4 pb-2 bg-white border-b">
        <h1 className="text-xl font-bold text-gray-800">Timeline</h1>
        <ProjectFilter projects={projects} />
      </div>
      <div className="flex-1 overflow-auto">
        <DndContext sensors={sensors} collisionDetection={rectIntersection} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <TimelineView
            tasks={selectedProjectIds === null ? tasks : tasks.filter((t) => t.project_id !== null && selectedProjectIds.has(t.project_id))}
            projects={selectedProjectIds === null ? projects : projects.filter((p) => selectedProjectIds.has(p.id))}
            people={people}
            onTaskClick={setSelected}
            onToggleDone={async (id: number, newStatus: TaskStatus) => { await tasksApi.update(id, { status: newStatus }); await fetchTasks(); }}
            onReorderProjects={reorderProjects}
            onRefresh={() => fetchTasks()}
          />
          <DragOverlay>
            {draggingTask && (
              <div className="bg-white rounded-lg border-2 border-indigo-400 shadow-xl p-3 w-56 opacity-90">
                <div className="text-sm font-medium text-gray-800">{draggingTask.title}</div>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>
      <TaskDetailPanel task={selected} projects={projects} people={people} onClose={() => setSelected(null)} onUpdated={() => fetchTasks()} />
    </div>
  );
}
