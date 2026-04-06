import { useEffect, useState } from 'react';
import { useTasksStore, useProjectsStore } from '../store';
import { tasksApi } from '../api/tasks.api';
import { KanbanBoard } from '../components/kanban/KanbanBoard';
import { FilterBar } from '../components/filters/FilterBar';
import type { FilterValue } from '../components/filters/filterConfig';
import type { TaskStatus, Person } from '@pis/shared';

export function KanbanPage() {
  const { tasks, fetchTasks, moveTask } = useTasksStore();
  const { projects, fetchProjects } = useProjectsStore();
  const [filters, setFilters] = useState<FilterValue>({});

  useEffect(() => { fetchProjects(); }, [fetchProjects]);
  useEffect(() => { fetchTasks({ project: filters.project, person: filters.person }); }, [fetchTasks, filters.project, filters.person]);

  const handleAdd = async (status: TaskStatus) => {
    const title = prompt('Task title:');
    if (!title) return;
    await tasksApi.create({ title, status, project_id: filters.project });
    fetchTasks();
  };

  const people: Person[] = [];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 pt-4 pb-2 border-b bg-white">
        <h1 className="text-xl font-bold text-gray-800">Kanban</h1>
        <FilterBar value={filters} onChange={setFilters} projects={projects} people={people} />
      </div>
      <div className="flex-1 overflow-auto">
        <KanbanBoard tasks={tasks} projects={projects} onMoveTask={(id, s, i) => moveTask(id, { status: s, order_index: i })} onAddTask={handleAdd} />
      </div>
    </div>
  );
}
