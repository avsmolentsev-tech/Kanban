import { useEffect, useState } from 'react';
import { useTasksStore, useProjectsStore } from '../store';
import { KanbanBoard } from '../components/kanban/KanbanBoard';
import { FilterBar } from '../components/filters/FilterBar';
import type { FilterValue } from '../components/filters/filterConfig';
import type { Person } from '@pis/shared';
import { peopleApi } from '../api/people.api';

export function KanbanPage() {
  const { tasks, fetchTasks, moveTask } = useTasksStore();
  const { projects, fetchProjects, reorderProjects } = useProjectsStore();
  const [filters, setFilters] = useState<FilterValue>({});
  const [people, setPeople] = useState<Person[]>([]);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);
  useEffect(() => { fetchTasks({ project: filters.project, person: filters.person }); }, [fetchTasks, filters.project, filters.person]);
  useEffect(() => { peopleApi.list().then(setPeople).catch(() => {}); }, []);

  const refresh = () => { fetchTasks({ project: filters.project, person: filters.person }); fetchProjects(); };

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

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 pt-4 pb-2 border-b bg-white">
        <h1 className="text-xl font-bold text-gray-800">Kanban</h1>
        <FilterBar value={filters} onChange={setFilters} projects={projects} people={people} />
      </div>
      <div className="flex-1 overflow-auto">
        <KanbanBoard tasks={tasks} projects={projects} people={people} onMoveTask={(id, s, i) => moveTask(id, { status: s, order_index: i })} onRefresh={refresh} onMoveProject={handleMoveProject} />
      </div>
    </div>
  );
}
