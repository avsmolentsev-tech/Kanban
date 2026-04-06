import { useEffect, useState } from 'react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { useTasksStore, useProjectsStore } from '../store';
import { tasksApi } from '../api/tasks.api';
import { TimelineView, type TimePeriod } from '../components/timeline/TimelineView';
import { TaskDetailPanel } from '../components/kanban/TaskDetailPanel';
import type { Task } from '@pis/shared';

const PERIODS: Array<{ key: TimePeriod; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'year', label: 'This Year' },
];

function computeDueDate(period: TimePeriod): string {
  const now = new Date();
  switch (period) {
    case 'today':
      return now.toISOString().split('T')[0]!;
    case 'week': {
      const end = new Date(now);
      end.setDate(now.getDate() + (5 - now.getDay())); // Friday this week
      return end.toISOString().split('T')[0]!;
    }
    case 'month': {
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0); // last day of month
      return end.toISOString().split('T')[0]!;
    }
    case 'year':
      return `${now.getFullYear()}-12-31`;
  }
}

export function TimelinePage() {
  const { tasks, fetchTasks } = useTasksStore();
  const { projects, fetchProjects } = useProjectsStore();
  const [period, setPeriod] = useState<TimePeriod>('today');
  const [selected, setSelected] = useState<Task | null>(null);
  const pMap = new Map(projects.map((p) => [p.id, p]));

  useEffect(() => { fetchTasks(); fetchProjects(); }, [fetchTasks, fetchProjects]);

  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;
    const overId = String(over.id);

    if (overId.startsWith('timeline-')) {
      const targetPeriod = overId.replace('timeline-', '') as TimePeriod | 'unscheduled';
      const taskId = Number(active.id);

      if (targetPeriod === 'unscheduled') {
        await tasksApi.update(taskId, { due_date: null });
      } else {
        const newDueDate = computeDueDate(targetPeriod);
        await tasksApi.update(taskId, { due_date: newDueDate });
      }
      await fetchTasks();
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-0 bg-white border-b">
        <h1 className="text-xl font-bold text-gray-800 mb-3">Timeline</h1>
        <div className="flex gap-0">
          {PERIODS.map(({ key, label }) => (
            <button key={key} onClick={() => setPeriod(key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${period === key ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <TimelineView tasks={tasks} projects={projects} period={period} onTaskClick={setSelected} />
        </DndContext>
      </div>
      <TaskDetailPanel task={selected} project={selected?.project_id ? pMap.get(selected.project_id) : undefined} onClose={() => setSelected(null)} />
    </div>
  );
}
