import { useEffect, useState } from 'react';
import { DndContext, rectIntersection, type DragEndEvent, type DragStartEvent, MouseSensor, TouchSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { useTasksStore, useProjectsStore, useFiltersStore } from '../store';
import { tasksApi } from '../api/tasks.api';
import { peopleApi } from '../api/people.api';
import { TimelineView, type TimePeriod, classifyTask } from '../components/timeline/TimelineView';
import { TaskDetailPanel } from '../components/kanban/TaskDetailPanel';
import { ProjectFilter } from '../components/filters/ProjectFilter';
import { SavedFilters, applyFilterCriteria, type SavedFilter } from '../components/filters/SavedFilters';
import type { Task, Person, TaskStatus } from '@pis/shared';
import { useLangStore } from '../store/lang.store';
import { BarChart3 } from 'lucide-react';

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function computeDueDate(period: TimePeriod | 'none'): string | null {
  if (period === 'none') return null;
  const now = new Date();
  switch (period) {
    case 'today':
      return localDateStr(now);
    case 'tomorrow': {
      const d = new Date(now);
      d.setDate(now.getDate() + 1);
      return localDateStr(d);
    }
    case 'week': {
      const d = new Date(now);
      d.setDate(now.getDate() + 5);
      return localDateStr(d);
    }
    case 'month': {
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return localDateStr(end);
    }
    case 'year':
      return `${now.getFullYear()}-12-31`;
  }
}

export function TimelinePage() {
  const { t } = useLangStore();
  const { tasks, fetchTasks } = useTasksStore();
  const { projects, fetchProjects, reorderProjects } = useProjectsStore();
  const [selected, setSelected] = useState<Task | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [activeFilter, setActiveFilter] = useState<SavedFilter | null>(null);
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
      let target: TimePeriod | 'none' | 'done' | 'someday' | 'backlog' | null = null;

      if (overId.startsWith('timeline-')) {
        // Format: timeline-{projectId}-{period}
        const parts = overId.split('-');
        target = parts[parts.length - 1] as TimePeriod | 'none' | 'done' | 'someday' | 'backlog';
        const targetProjectPart = parts.slice(1, -1).join('-');
        const targetProjectId = targetProjectPart === 'none' ? null : Number(targetProjectPart);
        const task = tasks.find((t) => t.id === taskId);
        if (task && task.project_id !== targetProjectId) {
          if (target === 'done' || target === 'someday' || target === 'backlog') {
            await tasksApi.update(taskId, { status: target, project_id: targetProjectId });
          } else {
            const updates: Record<string, unknown> = { due_date: computeDueDate(target), project_id: targetProjectId };
            if (task.status === 'done' || task.status === 'someday' || task.status === 'backlog') updates.status = 'todo';
            await tasksApi.update(taskId, updates);
          }
          await fetchTasks();
          return;
        }
      } else {
        const overTask = tasks.find((t) => t.id === Number(overId));
        if (overTask) {
          target = overTask.status === 'done' ? 'done' : overTask.status === 'someday' ? 'someday' : overTask.status === 'backlog' ? 'backlog' : classifyTask(overTask.due_date);
        }
      }

      if (target === 'done' || target === 'someday' || target === 'backlog') {
        await tasksApi.update(taskId, { status: target });
        await fetchTasks();
      } else if (target !== null) {
        const task = tasks.find((t) => t.id === taskId);
        const updates: Record<string, unknown> = { due_date: computeDueDate(target) };
        if (task?.status === 'done' || task?.status === 'someday' || task?.status === 'backlog') updates.status = 'todo';
        await tasksApi.update(taskId, updates);
        await fetchTasks();
      }
    }
  };

  return (
    <div className="relative overflow-hidden flex flex-col h-full">
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full border border-indigo-400/20 dark:border-white/[0.06]" style={{ animation: 'circleLeft 40s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute -top-20 -right-20 w-[350px] h-[350px] rounded-full border border-purple-400/25 dark:border-white/[0.06]" style={{ animation: 'circleLeftSlow 36s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] h-[500px] rounded-full bg-indigo-400/[0.08] dark:bg-white/[0.03] blur-[80px]" style={{ animation: 'circleRight 42s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="relative z-10 page-header flex items-center justify-between px-4 pt-4 pb-2 border-b bg-white dark:bg-gray-900 dark:border-gray-700">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/25">
            <BarChart3 size={20} className="text-white" />
          </div>
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('Таймлайн', 'Timeline')}</h1>
        </div>
        <div className="flex items-center gap-3">
          <SavedFilters active={activeFilter?.id ?? null} onApply={setActiveFilter} />
          <ProjectFilter projects={projects} />
        </div>
      </div>
      <div className="relative z-10 flex-1 overflow-hidden">
        <DndContext sensors={sensors} collisionDetection={rectIntersection} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <TimelineView
            tasks={applyFilterCriteria(
              selectedProjectIds === null ? tasks : tasks.filter((t) => t.project_id !== null && selectedProjectIds.has(t.project_id)),
              activeFilter?.criteria ?? {}
            )}
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
      <TaskDetailPanel task={selected} projects={projects} people={people} onClose={() => setSelected(null)} onUpdated={() => fetchTasks()} onDeleted={() => { setSelected(null); fetchTasks(); }} />
    </div>
  );
}
