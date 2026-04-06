import { useEffect, useState } from 'react';
import { useTasksStore, useProjectsStore, useFiltersStore } from '../store';
import { KanbanBoard } from '../components/kanban/KanbanBoard';
import { ProjectFilter } from '../components/filters/ProjectFilter';
import type { Person, TaskStatus } from '@pis/shared';
import { peopleApi } from '../api/people.api';
import { tasksApi } from '../api/tasks.api';

export function KanbanPage() {
  const { tasks, fetchTasks, moveTask } = useTasksStore();
  const { projects, fetchProjects, reorderProjects } = useProjectsStore();
  const { selectedProjectIds } = useFiltersStore();
  const [people, setPeople] = useState<Person[]>([]);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);
  useEffect(() => { fetchTasks(); }, [fetchTasks]);
  useEffect(() => { peopleApi.list().then(setPeople).catch(() => {}); }, []);

  const refresh = () => { fetchTasks(); fetchProjects(); };

  const handleToggleDone = async (id: number, newStatus: TaskStatus) => {
    await tasksApi.update(id, { status: newStatus });
    refresh();
  };

  const filteredTasks = selectedProjectIds === null ? tasks : tasks.filter((t) => t.project_id !== null && selectedProjectIds.has(t.project_id));
  const filteredProjects = selectedProjectIds === null ? projects : projects.filter((p) => selectedProjectIds.has(p.id));

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 pt-4 pb-2 border-b bg-white">
        <h1 className="text-xl font-bold text-gray-800">Kanban</h1>
        <ProjectFilter projects={projects} />
      </div>
      <div className="flex-1 overflow-auto">
        <KanbanBoard
          tasks={filteredTasks}
          projects={filteredProjects}
          people={people}
          onMoveTask={(id, s, i) => moveTask(id, { status: s, order_index: i })}
          onToggleDone={handleToggleDone}
          onRefresh={refresh}
          onReorderProjects={reorderProjects}
        />
      </div>
    </div>
  );
}
