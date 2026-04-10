import { useEffect, useState } from 'react';
import {
  DndContext,
  rectIntersection,
  type DragEndEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  DragOverlay,
} from '@dnd-kit/core';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api/client';
import { ProjectFilter } from '../components/filters/ProjectFilter';
import { useFiltersStore, useProjectsStore } from '../store';
import { DocumentDetailPanel } from '../components/documents/DocumentDetailPanel';
import type { Document } from '../components/documents/DocumentDetailPanel';
import type { Project } from '@pis/shared';

const CATEGORIES = ['note', 'reference', 'template', 'archive'] as const;
type Category = typeof CATEGORIES[number];

const CAT_COLORS: Record<Category, string> = {
  note: '#6366f1',
  reference: '#10b981',
  template: '#f59e0b',
  archive: '#9ca3af',
};

function CategoryBadge({ category }: { category: Category }) {
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded-full text-white font-medium"
      style={{ backgroundColor: CAT_COLORS[category] }}
    >
      {category}
    </span>
  );
}

function DraggableDocumentCard({
  doc,
  onClick,
  onDelete,
}: {
  doc: Document;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `doc-${doc.id}`,
  });
  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className="bg-white rounded-xl border border-gray-200 p-4 w-64 cursor-pointer hover:border-indigo-300 hover:shadow-sm transition-all group relative"
    >
      <button
        onClick={onDelete}
        className="absolute top-2 right-2 text-gray-300 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
        title="Удалить"
      >
        ✕
      </button>
      <div className="font-medium text-gray-800 truncate pr-4">{doc.title}</div>
      {doc.body && (
        <p className="text-xs text-gray-500 mt-1.5 line-clamp-2 leading-relaxed">{doc.body}</p>
      )}
      <div className="flex items-center gap-2 mt-2">
        <CategoryBadge category={doc.category} />
        <span className="text-[10px] text-gray-400 ml-auto">{doc.updated_at.split('T')[0]}</span>
      </div>
    </div>
  );
}

function DocumentDropZone({
  projectId,
  project,
  groupDocs,
  onClickDoc,
  onDeleteDoc,
}: {
  projectId: number | null;
  project: Project | null;
  groupDocs: Document[];
  onClickDoc: (d: Document) => void;
  onDeleteDoc: (id: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `doc-zone-${projectId ?? 'none'}` });

  return (
    <div className="flex">
      <div className="sticky left-0 z-20 w-40 min-w-[160px] flex-shrink-0 pr-3 pt-3 bg-gray-50 border-r border-gray-100">
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: project?.color ?? '#9ca3af' }}
          />
          <span className="text-sm font-semibold text-gray-700 truncate">
            {project?.name ?? 'Без проекта'}
          </span>
        </div>
        <div className="text-xs text-gray-400 mt-1 ml-5">
          {groupDocs.length} док.
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={`flex gap-3 flex-wrap flex-1 min-h-[60px] rounded-xl p-2 transition-colors ${
          isOver ? 'bg-indigo-50 border-2 border-dashed border-indigo-300' : ''
        }`}
      >
        {groupDocs.map((d) => (
          <DraggableDocumentCard
            key={d.id}
            doc={d}
            onClick={() => onClickDoc(d)}
            onDelete={(e) => {
              e.stopPropagation();
              onDeleteDoc(d.id);
            }}
          />
        ))}
        {groupDocs.length === 0 && (
          <div className="text-gray-300 text-xs self-center">Перетащи сюда</div>
        )}
      </div>
    </div>
  );
}

export function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const { projects, fetchProjects } = useProjectsStore();
  const { selectedProjectIds: filterProjectIds } = useFiltersStore();
  const [selected, setSelected] = useState<Document | null>(null);
  const [draggingDoc, setDraggingDoc] = useState<Document | null>(null);

  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newCategory, setNewCategory] = useState<Category>('note');
  const [newProjectId, setNewProjectId] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);

  const mouseSensor = useSensor(MouseSensor, { activationConstraint: { distance: 3 } });
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } });
  const sensors = useSensors(mouseSensor, touchSensor);

  const load = () => {
    apiGet<Document[]>('/documents').then(setDocuments).catch(() => {});
  };

  useEffect(() => {
    load();
    fetchProjects();
  }, [fetchProjects]);

  const submit = async () => {
    if (!newTitle.trim()) return;
    setSubmitting(true);
    try {
      await apiPost('/documents', {
        title: newTitle.trim(),
        body: newBody,
        category: newCategory,
        project_id: newProjectId !== '' ? Number(newProjectId) : null,
      });
      setNewTitle('');
      setNewBody('');
      setNewCategory('note');
      setNewProjectId('');
      setAdding(false);
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    await apiDelete(`/documents/${id}`);
    load();
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    setDraggingDoc(null);
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (!activeId.startsWith('doc-') || !overId.startsWith('doc-zone-')) return;
    const docId = Number(activeId.replace('doc-', ''));
    const targetStr = overId.replace('doc-zone-', '');
    const targetPid = targetStr === 'none' ? null : Number(targetStr);
    const doc = documents.find((d) => d.id === docId);
    if (!doc) return;
    const currentPid = doc.project_id ?? null;
    if (currentPid === targetPid) return;
    await apiPatch(`/documents/${docId}`, { project_id: targetPid });
    load();
  };

  // Group by project
  const projectMap = new Map<number, Project>(projects.map((p) => [p.id, p]));

  const groupMap = new Map<number | null, Document[]>();
  for (const doc of documents) {
    const pid = doc.project_id ?? null;
    if (!groupMap.has(pid)) groupMap.set(pid, []);
    groupMap.get(pid)!.push(doc);
  }

  const grouped: Array<{ project: Project | null; docs: Document[] }> = [];
  for (const [pid, groupDocs] of groupMap.entries()) {
    grouped.push({
      project: pid !== null ? (projectMap.get(pid) ?? null) : null,
      docs: groupDocs,
    });
  }

  grouped.sort((a, b) => {
    if (a.project === null) return 1;
    if (b.project === null) return -1;
    return (a.project.order_index ?? 0) - (b.project.order_index ?? 0);
  });

  const filteredGrouped =
    filterProjectIds === null
      ? grouped
      : grouped.filter((g) => g.project !== null && filterProjectIds.has(g.project.id));

  const activeProjects = projects.filter((p) => !p.archived);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-800">Документы</h1>
        <div className="flex items-center gap-3">
          <ProjectFilter projects={projects} />
          {!adding && (
            <button
              onClick={() => setAdding(true)}
              className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 flex-shrink-0"
            >
              + Новый документ
            </button>
          )}
        </div>
      </div>

      {adding && (
        <div className="bg-white rounded-xl border border-indigo-200 shadow-lg p-4 mb-6 max-w-md space-y-3">
          <input
            autoFocus
            className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:border-indigo-300"
            placeholder="Название документа *"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setAdding(false);
              if (e.key === 'Enter') submit();
            }}
          />
          <textarea
            className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:border-indigo-300 resize-none"
            placeholder="Содержание..."
            rows={3}
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
          />
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500 mr-1">Категория:</span>
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setNewCategory(c)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors capitalize ${
                  newCategory === c ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-200'
                }`}
                style={newCategory === c ? { backgroundColor: CAT_COLORS[c] } : undefined}
              >
                {c}
              </button>
            ))}
          </div>
          <select
            className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:border-indigo-300 bg-white"
            value={newProjectId}
            onChange={(e) => setNewProjectId(e.target.value !== '' ? Number(e.target.value) : '')}
          >
            <option value="">Без проекта</option>
            {activeProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setAdding(false)}
              className="text-sm text-gray-400 hover:text-gray-600 px-3 py-1.5"
            >
              Отмена
            </button>
            <button
              onClick={submit}
              disabled={!newTitle.trim() || submitting}
              className="text-sm bg-indigo-600 text-white px-4 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? '...' : 'Добавить документ'}
            </button>
          </div>
        </div>
      )}

      {documents.length === 0 && !adding && (
        <div className="text-gray-400 text-sm">Нет документов</div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={rectIntersection}
        onDragStart={(e) =>
          setDraggingDoc(
            documents.find((d) => d.id === Number(String(e.active.id).replace('doc-', ''))) ?? null
          )
        }
        onDragEnd={handleDragEnd}
      >
        <div className="space-y-4">
          {filteredGrouped.map(({ project, docs }) => (
            <DocumentDropZone
              key={project?.id ?? 'unassigned'}
              projectId={project?.id ?? null}
              project={project}
              groupDocs={docs}
              onClickDoc={setSelected}
              onDeleteDoc={handleDelete}
            />
          ))}
        </div>
        <DragOverlay>
          {draggingDoc && (
            <div className="bg-white rounded-xl border-2 border-indigo-400 shadow-xl p-4 w-64 opacity-90">
              <div className="font-medium text-gray-800 truncate">{draggingDoc.title}</div>
              <div className="mt-1.5">
                <CategoryBadge category={draggingDoc.category} />
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <DocumentDetailPanel
        document={selected}
        projects={projects}
        onClose={() => setSelected(null)}
        onUpdated={() => {
          load();
          setSelected((prev) => (prev ? { ...prev } : null));
        }}
      />
    </div>
  );
}
