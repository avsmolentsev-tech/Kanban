import { useEffect, useState } from 'react';
import { DndContext, rectIntersection, type DragEndEvent, MouseSensor, TouchSensor, useSensor, useSensors, useDroppable, useDraggable, DragOverlay } from '@dnd-kit/core';
import { apiGet, apiPost, apiPatch } from '../api/client';
import { ProjectFilter } from '../components/filters/ProjectFilter';
import { useFiltersStore, useProjectsStore } from '../store';
import { IdeaDetailPanel } from '../components/ideas/IdeaDetailPanel';
import type { Project } from '@pis/shared';
import { useLangStore } from '../store/lang.store';
import { Lightbulb } from 'lucide-react';

interface Idea {
  id: number;
  title: string;
  body: string;
  category: 'business' | 'product' | 'personal' | 'growth';
  project_id: number | null;
  vault_path: string | null;
  status: 'backlog' | 'in_obsidian' | 'completed' | 'garbage';
  created_at: string;
}

type IdeaStatus = Idea['status'];

const STATUSES: IdeaStatus[] = ['backlog', 'in_obsidian', 'completed', 'garbage'];
const STATUS_COLORS: Record<IdeaStatus, string> = {
  backlog: 'text-purple-600',
  in_obsidian: 'text-indigo-600',
  completed: 'text-green-600',
  garbage: 'text-red-400',
};

function DraggableIdeaCard({ idea, project, onClick }: { idea: Idea; project: Project | null; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `idea-${idea.id}` });
  const style = { transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, opacity: isDragging ? 0.4 : 1 };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} onClick={onClick}
      className="bg-white rounded-lg border border-gray-200 p-3 hover:border-indigo-300 hover:shadow-sm transition-all cursor-pointer">
      <div className="text-sm font-medium text-gray-800 mb-1">{idea.title}</div>
      {idea.body && <div className="text-xs text-gray-500 line-clamp-2 mb-1.5">{idea.body}</div>}
      <div className="text-[10px] text-gray-400">{idea.created_at.split('T')[0]}</div>
      {idea.vault_path && (
        <div className="text-[10px] text-indigo-400 truncate mt-0.5">📄 {idea.vault_path}</div>
      )}
    </div>
  );
}

function IdeaColumn({ projectId, status, ideas, projects, onClickIdea }: {
  projectId: number | null; status: IdeaStatus; ideas: Idea[]; projects: Project[]; onClickIdea: (idea: Idea) => void;
}) {
  const droppableId = `idea-${projectId ?? 'none'}-${status}`;
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });
  const pMap = new Map(projects.map(p => [p.id, p]));

  return (
    <div ref={setNodeRef}
      className={`flex flex-col w-56 min-w-[224px] bg-gray-100 rounded-xl p-3 transition-colors ${isOver ? 'bg-indigo-50' : ''}`}>
      <div className="flex flex-col gap-2 flex-1 min-h-[60px]">
        {ideas.map(i => (
          <DraggableIdeaCard key={i.id} idea={i} project={i.project_id ? (pMap.get(i.project_id) ?? null) : null} onClick={() => onClickIdea(i)} />
        ))}
        {ideas.length === 0 && <div className="text-gray-300 text-xs text-center py-4">—</div>}
      </div>
    </div>
  );
}

export function IdeasPage() {
  const { t } = useLangStore();

  const STATUS_LABELS: Record<IdeaStatus, string> = {
    backlog: t('Бэклог', 'Backlog'),
    in_obsidian: t('В Obsidian', 'In Obsidian'),
    completed: t('Выполнено', 'Completed'),
    garbage: t('Мусор', 'Garbage'),
  };
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const { projects, fetchProjects } = useProjectsStore();
  const { selectedProjectIds } = useFiltersStore();
  const [selected, setSelected] = useState<Idea | null>(null);
  const [draggingIdea, setDraggingIdea] = useState<Idea | null>(null);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newProjectId, setNewProjectId] = useState<number | ''>('');

  const load = async () => {
    const data = await apiGet<Idea[]>('/ideas');
    setIdeas(data);
  };

  useEffect(() => { load(); fetchProjects(); }, [fetchProjects]);

  const submit = async () => {
    if (!newTitle.trim()) return;
    await apiPost('/ideas', {
      title: newTitle.trim(),
      project_id: newProjectId !== '' ? Number(newProjectId) : null,
      status: 'backlog',
      category: 'personal',
    });
    setNewTitle(''); setNewProjectId(''); setAdding(false);
    load();
  };

  const mouseSensor = useSensor(MouseSensor, { activationConstraint: { distance: 3 } });
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } });
  const sensors = useSensors(mouseSensor, touchSensor);

  const handleDragEnd = async (e: DragEndEvent) => {
    setDraggingIdea(null);
    const { active, over } = e;
    if (!over) return;
    const ideaId = Number(String(active.id).replace('idea-', ''));
    const overId = String(over.id);
    if (!overId.startsWith('idea-')) return;
    // Format: idea-{projectId}-{status}
    const parts = overId.replace('idea-', '').split('-');
    const status = parts.pop() as IdeaStatus;
    const targetProjectPart = parts.join('-');
    const targetProjectId = targetProjectPart === 'none' ? null : Number(targetProjectPart);

    const idea = ideas.find(i => i.id === ideaId);
    if (!idea) return;

    const updates: Record<string, unknown> = {};
    if (idea.status !== status) updates.status = status;
    if (idea.project_id !== targetProjectId) updates.project_id = targetProjectId;
    if (Object.keys(updates).length === 0) return;

    await apiPatch(`/ideas/${ideaId}`, updates);
    load();
  };

  // Filter
  const filteredIdeas = selectedProjectIds === null
    ? ideas
    : ideas.filter(i => i.project_id !== null && selectedProjectIds.has(i.project_id));

  // Group by project → status
  const byProject = new Map<number | null, Idea[]>();
  for (const i of filteredIdeas) {
    const key = i.project_id;
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key)!.push(i);
  }

  const activeProjects = projects.filter(p => !p.archived);
  const rows: Array<{ project: Project | null; ideas: Idea[] }> = [];
  for (const p of activeProjects) {
    const is = byProject.get(p.id);
    rows.push({ project: p, ideas: is ?? [] });
  }
  const unassigned = byProject.get(null);
  if (unassigned && unassigned.length > 0) {
    rows.push({ project: null, ideas: unassigned });
  }

  return (
    <div className="flex flex-col h-full">
      <div className="page-header flex items-center justify-between px-4 pt-4 pb-2 border-b bg-white dark:bg-gray-900 dark:border-gray-700">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/25">
            <Lightbulb size={20} className="text-white" />
          </div>
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('Идеи', 'Ideas')}</h1>
        </div>
        <div className="flex items-center gap-3">
          <ProjectFilter projects={projects} />
          {!adding && (
            <button onClick={() => setAdding(true)} className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">
              + {t('Идея', 'Idea')}
            </button>
          )}
        </div>
      </div>

      {adding && (
        <div className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 p-4">
          <div className="max-w-md space-y-3">
            <input autoFocus className="w-full text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 focus:outline-none focus:border-indigo-300 dark:focus:border-indigo-500 placeholder-gray-400 dark:placeholder-gray-500"
              placeholder={t('Название идеи', 'Idea title')} value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setAdding(false); }} />
            <select className="w-full text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 focus:outline-none focus:border-indigo-300 dark:focus:border-indigo-500"
              value={newProjectId} onChange={(e) => setNewProjectId(e.target.value !== '' ? Number(e.target.value) : '')}>
              <option value="">{t('Без проекта', 'No project')}</option>
              {activeProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <div className="flex justify-end gap-2">
              <button onClick={() => setAdding(false)} className="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 px-3 py-1.5">{t('Отмена', 'Cancel')}</button>
              <button onClick={submit} disabled={!newTitle.trim()}
                className="text-sm bg-indigo-600 text-white px-4 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {t('Добавить', 'Add')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto relative">
        <DndContext sensors={sensors} collisionDetection={rectIntersection}
          onDragStart={(e) => {
            const id = Number(String(e.active.id).replace('idea-', ''));
            setDraggingIdea(ideas.find(i => i.id === id) ?? null);
          }}
          onDragEnd={handleDragEnd}>

          {/* Sticky column headers */}
          <div className="sticky top-0 z-30 flex bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 py-2">
            <div className="sticky left-0 z-40 w-40 min-w-[160px] flex-shrink-0 pl-4" style={{ background: 'inherit' }} />
            {STATUSES.map(s => (
              <div key={s} className={`w-56 min-w-[224px] mx-1.5 text-sm font-semibold text-center ${STATUS_COLORS[s]}`}>
                {STATUS_LABELS[s]}
              </div>
            ))}
          </div>

          {/* Project rows */}
          <div className="p-4 pt-2">
            {rows.map(({ project, ideas: rowIdeas }) => {
              const grouped: Record<IdeaStatus, Idea[]> = { backlog: [], in_obsidian: [], completed: [], garbage: [] };
              for (const i of rowIdeas) grouped[i.status ?? 'backlog'].push(i);

              return (
                <div key={project?.id ?? 'none'} className="flex mb-4">
                  <div className="sticky left-0 top-12 z-20 w-40 min-w-[160px] flex-shrink-0 pr-3 pt-3 border-r border-gray-100 dark:border-gray-700/50 self-start" style={{ background: 'inherit' }}>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: project?.color ?? '#9ca3af' }} />
                      <span className="text-sm font-semibold text-gray-700 truncate">{project?.name ?? t('Без проекта', 'No project')}</span>
                    </div>
                    <div className="text-xs text-gray-400 mt-1 ml-5">{rowIdeas.length} {t('идей', 'ideas')}</div>
                  </div>

                  <div className="flex gap-3">
                    {STATUSES.map(status => (
                      <IdeaColumn key={`${project?.id ?? 'none'}-${status}`}
                        projectId={project?.id ?? null} status={status}
                        ideas={grouped[status]} projects={projects} onClickIdea={setSelected} />
                    ))}
                  </div>
                </div>
              );
            })}

            {rows.length === 0 && (
              <div className="text-gray-400 text-sm text-center py-8">{t('Нет идей', 'No ideas')}</div>
            )}
          </div>

          <DragOverlay>
            {draggingIdea && (
              <div className="bg-white rounded-lg border-2 border-indigo-400 shadow-xl p-3 w-56 opacity-90">
                <div className="text-sm font-medium text-gray-800">{draggingIdea.title}</div>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>

      <IdeaDetailPanel
        idea={selected}
        projects={projects}
        onClose={() => setSelected(null)}
        onUpdated={() => { load(); setSelected(null); }}
        onDeleted={() => { setSelected(null); load(); }}
      />
    </div>
  );
}
