import { useEffect, useState } from 'react';
import { DndContext, rectIntersection, type DragEndEvent, MouseSensor, TouchSensor, useSensor, useSensors, useDroppable, useDraggable, DragOverlay } from '@dnd-kit/core';
import { apiGet, apiPost, apiPatch } from '../api/client';
import { ProjectFilter } from '../components/filters/ProjectFilter';
import { useFiltersStore, useProjectsStore } from '../store';
import { IdeaDetailPanel } from '../components/ideas/IdeaDetailPanel';

interface Idea {
  id: number;
  title: string;
  body: string;
  category: 'business' | 'product' | 'personal' | 'growth';
  project_id: number | null;
  vault_path: string | null;
  created_at: string;
}

const CATEGORIES = ['business', 'product', 'personal', 'growth'] as const;
const CAT_COLORS: Record<string, string> = {
  business: '#6366f1',
  product: '#10b981',
  personal: '#f59e0b',
  growth: '#ec4899',
};

function DraggableIdeaCard({ idea, project, onClick }: { idea: Idea; project: { name: string; color: string } | null; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `idea-${idea.id}` });
  const style = { transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, opacity: isDragging ? 0.4 : 1 };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} onClick={onClick}
      className="bg-white rounded-lg border border-gray-200 p-3 hover:border-indigo-300 hover:shadow-sm transition-all cursor-pointer">
      <div className="text-sm font-medium text-gray-800 mb-1">{idea.title}</div>
      {idea.body && <div className="text-xs text-gray-500 line-clamp-2 mb-1.5">{idea.body}</div>}
      <div className="flex items-center gap-1.5">
        {project && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full text-white" style={{ backgroundColor: project.color }}>
            {project.name}
          </span>
        )}
        <span className="text-[10px] text-gray-400 ml-auto">{idea.created_at.split('T')[0]}</span>
      </div>
    </div>
  );
}

function CategoryColumn({ cat, ideas, projectMap, onClickIdea }: {
  cat: string; ideas: Idea[]; projectMap: Map<number, { name: string; color: string }>;
  onClickIdea: (idea: Idea) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `cat-${cat}` });

  return (
    <div className="w-72 min-w-[288px] bg-gray-100 rounded-xl p-3">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CAT_COLORS[cat] }} />
        <h3 className="text-sm font-semibold text-gray-700 capitalize">{cat}</h3>
        <span className="text-xs text-gray-400">{ideas.length}</span>
      </div>
      <div ref={setNodeRef}
        className={`flex flex-col gap-2 min-h-[60px] rounded-lg p-1 transition-colors ${isOver ? 'bg-indigo-50 border-2 border-dashed border-indigo-300' : ''}`}>
        {ideas.map((idea) => (
          <DraggableIdeaCard key={idea.id} idea={idea} project={idea.project_id ? projectMap.get(idea.project_id) ?? null : null} onClick={() => onClickIdea(idea)} />
        ))}
        {ideas.length === 0 && <div className="text-gray-300 text-xs text-center py-4">Drop here</div>}
      </div>
    </div>
  );
}

export function IdeasPage() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const { projects, fetchProjects } = useProjectsStore();
  const { selectedProjectIds } = useFiltersStore();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<string>('personal');
  const [projectId, setProjectId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedIdea, setSelectedIdea] = useState<Idea | null>(null);
  const [draggingIdea, setDraggingIdea] = useState<Idea | null>(null);

  const mouseSensor = useSensor(MouseSensor, { activationConstraint: { distance: 3 } });
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } });
  const sensors = useSensors(mouseSensor, touchSensor);

  const load = () => { apiGet<Idea[]>('/ideas').then(setIdeas).catch(() => {}); };
  useEffect(() => { load(); fetchProjects(); }, [fetchProjects]);

  const submit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await apiPost('/ideas', { title: title.trim(), body, category, project_id: projectId });
      setTitle(''); setBody(''); setCategory('personal'); setProjectId(null);
      setAdding(false);
      load();
    } finally { setSubmitting(false); }
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    setDraggingIdea(null);
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (!activeId.startsWith('idea-') || !overId.startsWith('cat-')) return;
    const ideaId = Number(activeId.replace('idea-', ''));
    const newCategory = overId.replace('cat-', '');
    const idea = ideas.find((i) => i.id === ideaId);
    if (!idea || idea.category === newCategory) return;
    await apiPatch(`/ideas/${ideaId}`, { category: newCategory });
    load();
  };

  // Group by category
  const grouped: Record<string, Idea[]> = { business: [], product: [], personal: [], growth: [] };
  for (const idea of ideas) {
    if (selectedProjectIds !== null && idea.project_id !== null && !selectedProjectIds.has(idea.project_id)) continue;
    if (!grouped[idea.category]) grouped[idea.category] = [];
    grouped[idea.category]!.push(idea);
  }

  const projectMap = new Map(projects.map((p) => [p.id, { name: p.name, color: p.color }]));

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 pt-4 pb-2 bg-white border-b">
        <h1 className="text-xl font-bold text-gray-800">Ideas</h1>
        <div className="flex items-center gap-3">
          <ProjectFilter projects={projects} />
          {!adding && (
            <button onClick={() => setAdding(true)} className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 flex-shrink-0">
              + New idea
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {adding && (
          <div className="bg-white rounded-xl border border-indigo-200 shadow-lg p-4 mb-6 max-w-md space-y-3">
            <input autoFocus className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:border-indigo-300"
              placeholder="Idea title *" value={title} onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setAdding(false); }} />
            <textarea className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:border-indigo-300 resize-none"
              placeholder="Description..." rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500 mr-1">Category:</span>
              {CATEGORIES.map((c) => (
                <button key={c} onClick={() => setCategory(c)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors capitalize ${category === c ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-200'}`}
                  style={category === c ? { backgroundColor: CAT_COLORS[c] } : undefined}>
                  {c}
                </button>
              ))}
            </div>
            <select className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:border-indigo-300 bg-white"
              value={projectId ?? ''} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">No project</option>
              {projects.filter((p) => !p.archived).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <div className="flex justify-end gap-2">
              <button onClick={() => setAdding(false)} className="text-sm text-gray-400 hover:text-gray-600 px-3 py-1.5">Cancel</button>
              <button onClick={submit} disabled={!title.trim() || submitting}
                className="text-sm bg-indigo-600 text-white px-4 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {submitting ? '...' : 'Add idea'}
              </button>
            </div>
          </div>
        )}

        <DndContext sensors={sensors} collisionDetection={rectIntersection}
          onDragStart={(e) => setDraggingIdea(ideas.find((i) => i.id === Number(String(e.active.id).replace('idea-', ''))) ?? null)}
          onDragEnd={handleDragEnd}>
          <div className="flex gap-4 overflow-x-auto">
            {CATEGORIES.map((cat) => (
              <CategoryColumn key={cat} cat={cat} ideas={grouped[cat] ?? []} projectMap={projectMap} onClickIdea={setSelectedIdea} />
            ))}
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
        idea={selectedIdea}
        projects={projects}
        onClose={() => setSelectedIdea(null)}
        onUpdated={() => { load(); setSelectedIdea(null); }}
      />
    </div>
  );
}
