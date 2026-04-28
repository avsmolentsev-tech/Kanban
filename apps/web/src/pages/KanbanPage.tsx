import { useEffect, useState } from 'react';
import { Columns3 } from 'lucide-react';
import { useTasksStore, useProjectsStore, useFiltersStore } from '../store';
import { KanbanBoard } from '../components/kanban/KanbanBoard';
import { ProjectFilter } from '../components/filters/ProjectFilter';
import { SavedFilters, applyFilterCriteria, type SavedFilter } from '../components/filters/SavedFilters';
import type { Task, Project, Person, TaskStatus } from '@pis/shared';
import { peopleApi } from '../api/people.api';
import { tasksApi } from '../api/tasks.api';
import { useLangStore } from '../store/lang.store';
import { TaskCard } from '../components/kanban/TaskCard';
import { TaskDetailPanel } from '../components/kanban/TaskDetailPanel';

const KANBAN_MOBILE_TABS: Array<{ key: TaskStatus; shortRu: string; shortEn: string }> = [
  { key: 'backlog', shortRu: 'Бэк', shortEn: 'Back' },
  { key: 'todo', shortRu: 'Todo', shortEn: 'Todo' },
  { key: 'in_progress', shortRu: 'В работе', shortEn: 'Active' },
  { key: 'done', shortRu: 'Готово', shortEn: 'Done' },
  { key: 'someday', shortRu: 'Когда-н', shortEn: 'Some' },
];

/** Mobile: tabs by status, vertical list grouped by project */
function MobileKanbanView({ tasks, projects, people, onToggleDone, onRefresh }: {
  tasks: Task[]; projects: Project[]; people: Person[];
  onToggleDone: (id: number, newStatus: TaskStatus) => void; onRefresh: () => void;
}) {
  const { t } = useLangStore();
  const [activeTab, setActiveTab] = useState<TaskStatus>('in_progress');
  const [selected, setSelected] = useState<Task | null>(null);
  const pMap = new Map(projects.map(p => [p.id, p]));

  // Group ALL tasks by status
  const byStatus: Record<TaskStatus, Task[]> = { backlog: [], todo: [], in_progress: [], done: [], someday: [] };
  for (const tk of tasks.filter(tk => !tk.archived)) {
    byStatus[tk.status].push(tk);
  }

  // Tasks for active tab, grouped by project
  const tabTasks = byStatus[activeTab];
  const byProject = new Map<number | null, Task[]>();
  for (const tk of tabTasks) {
    if (!byProject.has(tk.project_id)) byProject.set(tk.project_id, []);
    byProject.get(tk.project_id)!.push(tk);
  }

  // Ordered list: existing projects first, then unassigned
  const projectGroups: Array<{ project: Project | null; tasks: Task[] }> = [];
  for (const p of projects) {
    const pts = byProject.get(p.id);
    if (pts && pts.length > 0) projectGroups.push({ project: p, tasks: pts });
  }
  const unassigned = byProject.get(null);
  if (unassigned && unassigned.length > 0) projectGroups.push({ project: null, tasks: unassigned });

  // Count per tab for badges
  const tabCounts: Record<string, number> = {};
  for (const tab of KANBAN_MOBILE_TABS) tabCounts[tab.key] = byStatus[tab.key].length;

  return (
    <>
      <div className="flex flex-col h-full relative overflow-hidden">
        {/* Tab bar */}
        <div className="relative z-10 flex gap-1 px-3 py-2 overflow-x-auto bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          {KANBAN_MOBILE_TABS.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.key
                  ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}>
              {t(tab.shortRu, tab.shortEn)}
              {(tabCounts[tab.key] ?? 0) > 0 && (
                <span className={`min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold ${
                  activeTab === tab.key
                    ? 'bg-indigo-600 text-white'
                    : tab.key === 'in_progress' && (tabCounts[tab.key] ?? 0) > 0 ? 'bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                }`}>{tabCounts[tab.key]}</span>
              )}
            </button>
          ))}
        </div>

        {/* Task list grouped by project */}
        <div className="relative z-10 flex-1 overflow-auto px-3 py-2 space-y-4 pb-24">
          {projectGroups.length === 0 && (
            <div className="text-gray-400 dark:text-gray-500 text-sm text-center py-12">
              {activeTab === 'done' ? t('Нет завершённых задач', 'No completed tasks') : t('Нет задач', 'No tasks')}
            </div>
          )}
          {projectGroups.map(({ project, tasks: groupTasks }) => (
            <div key={project?.id ?? 'none'}>
              {/* Project header */}
              <div className="flex items-center gap-2 mb-2 px-1">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: project?.color ?? '#9ca3af' }} />
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{project?.name ?? t('Без проекта', 'No project')}</span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500">{groupTasks.length}</span>
              </div>
              {/* Task cards */}
              <div className="space-y-2">
                {groupTasks.map(tk => (
                  <TaskCard key={tk.id} task={tk} project={tk.project_id ? pMap.get(tk.project_id) : undefined}
                    onClick={() => setSelected(tk)} onToggleDone={onToggleDone} dragMode="draggable" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <TaskDetailPanel
        task={selected}
        projects={projects}
        people={people}
        onClose={() => setSelected(null)}
        onUpdated={() => { onRefresh(); setSelected(null); }}
      />
    </>
  );
}

export function KanbanPage() {
  const { t } = useLangStore();
  const { tasks, fetchTasks, moveTask } = useTasksStore();
  const { projects, fetchProjects, reorderProjects } = useProjectsStore();
  const { selectedProjectIds } = useFiltersStore();
  const [people, setPeople] = useState<Person[]>([]);
  const [activeFilter, setActiveFilter] = useState<SavedFilter | null>(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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

  if (isMobile) {
    return (
      <div className="relative overflow-hidden flex flex-col h-full">
        <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full bg-indigo-400/15 dark:bg-indigo-400/[0.10]" style={{ animation: 'circleLeft 30s cubic-bezier(0.45,0,0.55,1) infinite' }} />
        <div className="pointer-events-none absolute -top-20 -right-20 w-[350px] h-[350px] rounded-full bg-purple-400/12 dark:bg-purple-400/[0.08]" style={{ animation: 'circleLeftSlow 26s cubic-bezier(0.45,0,0.55,1) infinite' }} />
        <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] h-[500px] rounded-full bg-indigo-400/[0.14] dark:bg-violet-400/[0.09] blur-[80px]" style={{ animation: 'circleRight 34s cubic-bezier(0.45,0,0.55,1) infinite' }} />
        <div className="relative z-10 flex items-center justify-between px-4 pt-4 pb-2 border-b bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm dark:border-gray-700">
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
        <MobileKanbanView
          tasks={filteredTasks}
          projects={filteredProjects}
          people={people}
          onToggleDone={handleToggleDone}
          onRefresh={refresh}
        />
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden flex flex-col h-full">
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full bg-indigo-400/15 dark:bg-indigo-400/[0.10]" style={{ animation: 'circleLeft 30s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute -top-20 -right-20 w-[350px] h-[350px] rounded-full bg-purple-400/12 dark:bg-purple-400/[0.08]" style={{ animation: 'circleLeftSlow 26s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] h-[500px] rounded-full bg-indigo-400/[0.14] dark:bg-violet-400/[0.09] blur-[80px]" style={{ animation: 'circleRight 34s cubic-bezier(0.45,0,0.55,1) infinite' }} />
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
