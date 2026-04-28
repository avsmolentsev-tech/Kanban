import { useEffect, useState } from 'react';
import { DndContext, rectIntersection, type DragEndEvent, MouseSensor, TouchSensor, useSensor, useSensors, useDroppable, DragOverlay } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useProjectsStore } from '../store';
import { projectsApi } from '../api/projects.api';
import { apiGet } from '../api/client';
import { ProjectDetailPanel } from '../components/projects/ProjectDetailPanel';
import type { Project } from '@pis/shared';
import { useLangStore } from '../store/lang.store';
import { FolderKanban } from 'lucide-react';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived';

const STAGES: ProjectStatus[] = ['active', 'completed', 'archived'];

function getStageLabels(t: (ru: string, en: string) => string): Record<ProjectStatus, string> {
  return {
    active: t('🚀 Активные', '🚀 Active'),
    paused: t('⏸ На паузе', '⏸ Paused'),
    completed: t('🔄 В работе', '🔄 In Progress'),
    archived: t('✅ Завершены', '✅ Completed'),
  };
}

interface TaskStats {
  total: number;
  done: number;
  in_progress: number;
}

function DraggableProjectCard({ project, stats, onClick }: { project: Project; stats?: TaskStats; onClick: () => void }) {
  const { t } = useLangStore();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `proj-${project.id}` });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  const progress = stats && stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} onClick={onClick}
      className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 cursor-pointer hover:border-indigo-300 hover:shadow-sm transition-all">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: project.color }} />
        <span className="font-medium text-gray-800 dark:text-gray-100 truncate">{project.name}</span>
      </div>
      {project.description && <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 line-clamp-2">{project.description}</p>}

      {/* Task progress bar */}
      {stats && stats.total > 0 && (
        <div>
          <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
            <span>{stats.done}/{stats.total} {t('задач', 'tasks')}</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, backgroundColor: project.color }} />
          </div>
          {stats.in_progress > 0 && (
            <div className="text-[10px] text-gray-400 mt-1">🔄 {stats.in_progress} {t('в работе', 'in progress')}</div>
          )}
        </div>
      )}
    </div>
  );
}

function StageColumn({ stage, projects, statsMap, onClickProject }: {
  stage: ProjectStatus; projects: Project[]; statsMap: Map<number, TaskStats>; onClickProject: (p: Project) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage-${stage}` });

  return (
    <div ref={setNodeRef}
      className={`flex flex-col w-64 min-w-[256px] bg-gray-100 dark:bg-gray-800/50 rounded-xl p-3 transition-colors ${isOver ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''}`}>
      <SortableContext items={projects.map(p => `proj-${p.id}`)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-3 flex-1 min-h-[80px]">
          {projects.map(p => (
            <DraggableProjectCard key={p.id} project={p} stats={statsMap.get(p.id)} onClick={() => onClickProject(p)} />
          ))}
          {projects.length === 0 && <div className="text-gray-300 dark:text-gray-600 text-xs text-center py-4">—</div>}
        </div>
      </SortableContext>
    </div>
  );
}

export function ProjectsPage() {
  const { t } = useLangStore();
  const stageLabels = getStageLabels(t);
  const { projects, loading, fetchProjects } = useProjectsStore();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(COLORS[0]!);
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<Project | null>(null);
  const [dragging, setDragging] = useState<Project | null>(null);
  const [statsMap, setStatsMap] = useState<Map<number, TaskStats>>(new Map());

  const mouseSensor = useSensor(MouseSensor, { activationConstraint: { distance: 5 } });
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } });
  const sensors = useSensors(mouseSensor, touchSensor);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  // Fetch task stats per project
  useEffect(() => {
    if (projects.length === 0) return;
    (async () => {
      const map = new Map<number, TaskStats>();
      try {
        const tasks = await apiGet<Array<{ project_id: number | null; status: string }>>('/tasks');
        for (const t of tasks) {
          if (t.project_id === null) continue;
          if (!map.has(t.project_id)) map.set(t.project_id, { total: 0, done: 0, in_progress: 0 });
          const s = map.get(t.project_id)!;
          s.total++;
          if (t.status === 'done') s.done++;
          if (t.status === 'in_progress') s.in_progress++;
        }
      } catch {}
      setStatsMap(map);
    })();
  }, [projects]);

  const submit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await projectsApi.create({ name: name.trim(), description: description.trim(), color });
      setName(''); setDescription(''); setColor(COLORS[0]!); setAdding(false);
      fetchProjects();
    } finally { setSubmitting(false); }
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    setDragging(null);
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const projId = Number(activeId.replace('proj-', ''));

    // Dropped on a stage column
    if (overId.startsWith('stage-')) {
      const stage = overId.replace('stage-', '') as ProjectStatus;
      const project = projects.find(p => p.id === projId);
      if (!project || project.status === stage) return;
      await projectsApi.update(projId, { status: stage });
      fetchProjects();
      return;
    }

    // Dropped on another project card (reorder within same column)
    if (overId.startsWith('proj-')) {
      const overProjId = Number(overId.replace('proj-', ''));
      if (projId === overProjId) return;
      const activeProj = projects.find(p => p.id === projId);
      const overProj = projects.find(p => p.id === overProjId);
      if (!activeProj || !overProj) return;

      // If different status → move to that status
      if (activeProj.status !== overProj.status) {
        await projectsApi.update(projId, { status: overProj.status as ProjectStatus });
        fetchProjects();
        return;
      }

      // Same status → reorder
      const sameStatus = projects.filter(p => p.status === activeProj.status);
      const fromIdx = sameStatus.findIndex(p => p.id === projId);
      const toIdx = sameStatus.findIndex(p => p.id === overProjId);
      if (fromIdx === -1 || toIdx === -1) return;
      const reordered = arrayMove(sameStatus, fromIdx, toIdx);
      const items = reordered.map((p, i) => ({ id: p.id, order_index: i }));
      await projectsApi.reorder(items);
      fetchProjects();
    }
  };

  // Group by status
  const byStage: Record<ProjectStatus, Project[]> = { active: [], paused: [], completed: [], archived: [] };
  for (const p of projects) {
    (byStage[p.status as ProjectStatus] ?? byStage.active).push(p);
  }

  return (
    <div className="relative overflow-hidden flex flex-col h-full">
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full bg-indigo-400/15 dark:bg-indigo-400/[0.10]" style={{ animation: 'circleLeft 30s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute -top-20 -right-20 w-[350px] h-[350px] rounded-full bg-purple-400/12 dark:bg-purple-400/[0.08]" style={{ animation: 'circleLeftSlow 26s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] h-[500px] rounded-full bg-indigo-400/[0.14] dark:bg-violet-400/[0.09] blur-[80px]" style={{ animation: 'circleRight 34s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="relative z-10 page-header flex items-center justify-between px-6 py-4 border-b dark:border-gray-700">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
            <FolderKanban size={20} className="text-white" />
          </div>
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('Проекты', 'Projects')}</h1>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">
            {t('+ Новый проект', '+ New Project')}
          </button>
        )}
      </div>

      {adding && (
        <div className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 p-4">
          <div className="max-w-md space-y-3">
            <input autoFocus className="w-full text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 focus:outline-none focus:border-indigo-300 dark:focus:border-indigo-500 placeholder-gray-400 dark:placeholder-gray-500"
              placeholder={t('Название проекта...', 'Project name...')} value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setAdding(false); }} />
            <input className="w-full text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 focus:outline-none focus:border-indigo-300 dark:focus:border-indigo-500 placeholder-gray-400 dark:placeholder-gray-500"
              placeholder={t('Описание (необязательно)', 'Description (optional)')} value={description} onChange={(e) => setDescription(e.target.value)} />
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-500 dark:text-gray-400 mr-2">{t('Цвет:', 'Color:')}</span>
              {COLORS.map((c) => (
                <button key={c} onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full border-2 transition-all ${color === c ? 'border-gray-800 dark:border-gray-200 scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setAdding(false)} className="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 px-3 py-1.5">{t('Отмена', 'Cancel')}</button>
              <button onClick={submit} disabled={!name.trim() || submitting}
                className="text-sm bg-indigo-600 text-white px-4 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {submitting ? '...' : t('Создать', 'Create')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="relative z-10 flex-1 overflow-auto">
        <DndContext sensors={sensors} collisionDetection={rectIntersection}
          onDragStart={(e) => { const id = Number(String(e.active.id).replace('proj-', '')); setDragging(projects.find(p => p.id === id) ?? null); }}
          onDragEnd={handleDragEnd}>

          {/* Sticky column headers */}
          <div className="sticky top-0 z-30 flex bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 py-2 px-4">
            {STAGES.map(s => (
              <div key={s} className="w-64 min-w-[256px] mx-2 text-sm font-semibold text-gray-500 dark:text-gray-400 text-center">
                {stageLabels[s]} ({byStage[s].length})
              </div>
            ))}
          </div>

          {/* Stage columns */}
          <div className="flex gap-4 p-4">
            {STAGES.map(stage => (
              <StageColumn key={stage} stage={stage} projects={byStage[stage]} statsMap={statsMap} onClickProject={setSelected} />
            ))}
          </div>

          <DragOverlay>
            {dragging && (
              <div className="bg-white dark:bg-gray-800 rounded-xl border-4 border-indigo-400 shadow-xl p-4 w-64 opacity-90">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: dragging.color }} />
                  <span className="font-medium text-gray-800 dark:text-gray-100">{dragging.name}</span>
                </div>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>

      {loading && <div className="absolute inset-0 flex items-center justify-center text-gray-400">{t('Загрузка...', 'Loading...')}</div>}

      <ProjectDetailPanel
        project={selected}
        onClose={() => setSelected(null)}
        onUpdated={() => { fetchProjects(); setSelected((prev) => prev ? (projects.find((p) => p.id === prev.id) ?? prev) : null); }}
        onDeleted={() => { setSelected(null); fetchProjects(); }}
      />
    </div>
  );
}
