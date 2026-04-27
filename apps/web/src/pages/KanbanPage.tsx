import { useEffect, useState } from 'react';
import { Columns3 } from 'lucide-react';
import { useTasksStore, useProjectsStore, useFiltersStore } from '../store';
import { KanbanBoard } from '../components/kanban/KanbanBoard';
import { ProjectFilter } from '../components/filters/ProjectFilter';
import { SavedFilters, applyFilterCriteria, type SavedFilter } from '../components/filters/SavedFilters';
import type { Person, TaskStatus } from '@pis/shared';
import { peopleApi } from '../api/people.api';
import { tasksApi } from '../api/tasks.api';
import { useLangStore } from '../store/lang.store';

export function KanbanPage() {
  const { t } = useLangStore();
  const { tasks, fetchTasks, moveTask } = useTasksStore();
  const { projects, fetchProjects, reorderProjects } = useProjectsStore();
  const { selectedProjectIds } = useFiltersStore();
  const [people, setPeople] = useState<Person[]>([]);
  const [activeFilter, setActiveFilter] = useState<SavedFilter | null>(null);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);
  useEffect(() => { fetchTasks(); }, [fetchTasks]);
  useEffect(() => { peopleApi.list().then(setPeople).catch(() => {}); }, []);

  const refresh = () => { fetchTasks(); fetchProjects(); };

  const handleToggleDone = async (id: number, newStatus: TaskStatus) => {
    await tasksApi.update(id, { status: newStatus });
    refresh();
  };

  const projectFilteredTasks = selectedProjectIds === null ? tasks : tasks.filter((t) => t.project_id !== null && selectedProjectIds.has(t.project_id));
  const filteredTasks = activeFilter ? applyFilterCriteria(projectFilteredTasks, activeFilter.criteria) : projectFilteredTasks;
  const filteredProjects = selectedProjectIds === null ? projects : projects.filter((p) => selectedProjectIds.has(p.id));

  return (
    <div className="relative overflow-hidden flex flex-col h-full">
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full border border-indigo-400/20 dark:border-white/[0.06]" style={{ animation: 'circleLeft 14s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute -top-20 -right-20 w-[350px] h-[350px] rounded-full border border-purple-400/25 dark:border-white/[0.06]" style={{ animation: 'circleLeftSlow 12s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] h-[500px] rounded-full bg-indigo-400/[0.08] dark:bg-white/[0.03] blur-[80px]" style={{ animation: 'circleRight 16s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="relative z-10 flex items-center justify-between px-4 pt-4 pb-2 border-b bg-white dark:bg-gray-900 dark:border-gray-700">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
            <Columns3 size={20} className="text-white" />
          </div>
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('Kanban-доска', 'Kanban Board')}</h1>
        </div>
        <div className="flex items-center gap-3">
          <SavedFilters active={activeFilter?.id ?? null} onApply={setActiveFilter} />
          <ProjectFilter projects={projects} />
        </div>
      </div>
      <div className="relative z-10 flex-1 overflow-hidden">
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
