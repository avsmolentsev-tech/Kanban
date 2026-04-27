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
import { useLangStore } from '../store/lang.store';
import { FileText } from 'lucide-react';

const CATEGORIES = ['note', 'reference', 'template', 'archive'] as const;
type Category = typeof CATEGORIES[number];

const DOC_STATUSES = ['draft', 'active', 'in_obsidian', 'archive'] as const;
type DocStatus = typeof DOC_STATUSES[number];
const STATUS_LABELS: Record<DocStatus, [string, string]> = {
  draft: ['Черновики', 'Drafts'],
  active: ['Активные', 'Active'],
  in_obsidian: ['В Obsidian', 'In Obsidian'],
  archive: ['Архив', 'Archive'],
};
const STATUS_COLORS: Record<DocStatus, string> = {
  draft: 'text-gray-500',
  active: 'text-indigo-600',
  in_obsidian: 'text-green-600',
  archive: 'text-gray-400',
};

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
  const { t } = useLangStore();
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
        title={t('Удалить', 'Delete')}
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

function DocStatusColumn({ droppableId, docs, onClickDoc, onDeleteDoc }: {
  droppableId: string; docs: Document[]; onClickDoc: (d: Document) => void; onDeleteDoc: (id: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });
  return (
    <div ref={setNodeRef}
      className={`flex flex-col w-56 min-w-[224px] bg-gray-100 rounded-xl p-3 transition-colors ${isOver ? 'bg-indigo-50' : ''}`}>
      <div className="flex flex-col gap-2 flex-1 min-h-[60px]">
        {docs.map(d => (
          <DraggableDocumentCard key={d.id} doc={d} onClick={() => onClickDoc(d)}
            onDelete={(e) => { e.stopPropagation(); onDeleteDoc(d.id); }} />
        ))}
        {docs.length === 0 && <div className="text-gray-300 text-xs text-center py-4">—</div>}
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
  const { t } = useLangStore();
  const { setNodeRef, isOver } = useDroppable({ id: `doc-zone-${projectId ?? 'none'}` });

  return (
    <div className="flex">
      <div className="sticky left-0 top-12 z-20 w-40 min-w-[160px] flex-shrink-0 pr-3 pt-3 border-r border-gray-100 dark:border-gray-700/50 self-start" style={{ background: 'inherit' }}>
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: project?.color ?? '#9ca3af' }}
          />
          <span className="text-sm font-semibold text-gray-700 truncate">
            {project?.name ?? t('Без проекта', 'No project')}
          </span>
        </div>
        <div className="text-xs text-gray-400 mt-1 ml-5">
          {groupDocs.length} {t('док.', 'docs')}
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
          <div className="text-gray-300 text-xs self-center">{t('Перетащи сюда', 'Drop here')}</div>
        )}
      </div>
    </div>
  );
}

export function DocumentsPage() {
  const { t } = useLangStore();
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
    if (!activeId.startsWith('doc-')) return;
    const docId = Number(activeId.replace('doc-', ''));

    // Format: doc-zone-{projectId}-{status} or doc-zone-{projectId}
    if (overId.startsWith('doc-zone-')) {
      const parts = overId.replace('doc-zone-', '').split('-');
      // Check if last part is a status
      const statuses = ['draft', 'active', 'in_obsidian', 'archive'];
      const lastPart = parts[parts.length - 1];
      if (lastPart && statuses.includes(lastPart)) {
        const status = parts.pop()!;
        const targetPid = parts.join('-') === 'none' ? null : Number(parts.join('-'));
        const updates: Record<string, unknown> = {};
        const doc = documents.find(d => d.id === docId);
        if (!doc) return;
        if (doc.project_id !== targetPid) updates['project_id'] = targetPid;
        if ((doc as unknown as Record<string, unknown>)['status'] !== status) updates['status'] = status;
        if (Object.keys(updates).length > 0) {
          await apiPatch(`/documents/${docId}`, updates);
          load();
        }
      } else {
        const targetPid = parts.join('-') === 'none' ? null : Number(parts.join('-'));
        await apiPatch(`/documents/${docId}`, { project_id: targetPid });
        load();
      }
    }
  };

  // Group by project
  const projectMap = new Map<number, Project>(projects.map((p) => [p.id, p]));
  const activeProjects = projects.filter((p) => !p.archived);

  // Filter
  const filtered = filterProjectIds === null
    ? documents
    : documents.filter(d => d.project_id !== null && filterProjectIds.has(d.project_id));

  // Group by project → status
  const byProject = new Map<number | null, Document[]>();
  for (const d of filtered) {
    const key = d.project_id;
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key)!.push(d);
  }

  const rows: Array<{ project: Project | null; docs: Document[] }> = [];
  for (const p of activeProjects) {
    const ds = byProject.get(p.id);
    rows.push({ project: p, docs: ds ?? [] });
  }
  const unassigned = byProject.get(null);
  if (unassigned && unassigned.length > 0) rows.push({ project: null, docs: unassigned });

  return (
    <div className="relative overflow-hidden flex flex-col h-full">
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full border border-indigo-400/20 dark:border-white/[0.06]" style={{ animation: 'circleLeft 14s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute -top-20 -right-20 w-[350px] h-[350px] rounded-full border border-purple-400/25 dark:border-white/[0.06]" style={{ animation: 'circleLeftSlow 12s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] h-[500px] rounded-full bg-indigo-400/[0.08] dark:bg-white/[0.03] blur-[80px]" style={{ animation: 'circleRight 16s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="relative z-10 page-header flex items-center justify-between px-4 pt-4 pb-2 border-b bg-white dark:bg-gray-900 dark:border-gray-700">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-slate-500 to-slate-600 flex items-center justify-center shadow-lg shadow-slate-500/25">
            <FileText size={20} className="text-white" />
          </div>
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('Документы', 'Documents')}</h1>
        </div>
        <div className="flex items-center gap-3">
          <ProjectFilter projects={projects} />
          {!adding && (
            <button
              onClick={() => setAdding(true)}
              className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 flex-shrink-0"
            >
              {t('+ Новый документ', '+ New document')}
            </button>
          )}
        </div>
      </div>

      {adding && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-indigo-200 dark:border-indigo-700 shadow-lg p-4 mb-6 max-w-md space-y-3">
          <input
            autoFocus
            className="w-full text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 focus:outline-none focus:border-indigo-300 dark:focus:border-indigo-500 placeholder-gray-400 dark:placeholder-gray-500"
            placeholder={t('Название документа *', 'Document title *')}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setAdding(false);
              if (e.key === 'Enter') submit();
            }}
          />
          <textarea
            className="w-full text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 focus:outline-none focus:border-indigo-300 dark:focus:border-indigo-500 resize-none placeholder-gray-400 dark:placeholder-gray-500"
            placeholder={t('Содержание...', 'Content...')}
            rows={3}
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
          />
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500 dark:text-gray-400 mr-1">{t('Категория:', 'Category:')}</span>
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setNewCategory(c)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors capitalize ${
                  newCategory === c ? 'text-white border-transparent' : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700'
                }`}
                style={newCategory === c ? { backgroundColor: CAT_COLORS[c] } : undefined}
              >
                {c}
              </button>
            ))}
          </div>
          <select
            className="w-full text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 focus:outline-none focus:border-indigo-300 dark:focus:border-indigo-500"
            value={newProjectId}
            onChange={(e) => setNewProjectId(e.target.value !== '' ? Number(e.target.value) : '')}
          >
            <option value="">{t('Без проекта', 'No project')}</option>
            {activeProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setAdding(false)}
              className="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 px-3 py-1.5"
            >
              {t('Отмена', 'Cancel')}
            </button>
            <button
              onClick={submit}
              disabled={!newTitle.trim() || submitting}
              className="text-sm bg-indigo-600 text-white px-4 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? '...' : t('Добавить документ', 'Add document')}
            </button>
          </div>
        </div>
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
        {/* Sticky header */}
        <div className="sticky top-0 z-30 flex bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 py-2">
          <div className="sticky left-0 z-40 w-40 min-w-[160px] flex-shrink-0 pl-4" style={{ background: 'inherit' }} />
          {DOC_STATUSES.map(s => (
            <div key={s} className={`w-56 min-w-[224px] mx-1.5 text-sm font-semibold text-center ${STATUS_COLORS[s]}`}>
              {t(...STATUS_LABELS[s])}
            </div>
          ))}
        </div>

        <div className="p-4 pt-2">
        {rows.map(({ project, docs: rowDocs }) => {
          const grouped: Record<string, Document[]> = { draft: [], active: [], in_obsidian: [], archive: [] };
          for (const d of rowDocs) {
            const st = ((d as unknown as Record<string, unknown>)['status'] as string) ?? 'draft';
            const bucket = grouped[st] ?? grouped['draft']!;
            bucket.push(d);
          }

          return (
            <div key={project?.id ?? 'none'} className="flex mb-4">
              <div className="sticky left-0 top-12 z-20 w-40 min-w-[160px] flex-shrink-0 pr-3 pt-3 border-r border-gray-100 dark:border-gray-700/50 self-start" style={{ background: 'inherit' }}>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: project?.color ?? '#9ca3af' }} />
                  <span className="text-sm font-semibold text-gray-700 truncate">{project?.name ?? t('Без проекта', 'No project')}</span>
                </div>
                <div className="text-xs text-gray-400 mt-1 ml-5">{rowDocs.length} {t('док.', 'docs')}</div>
              </div>
              <div className="flex gap-3">
                {DOC_STATUSES.map(status => {
                  const zoneId = `doc-zone-${project?.id ?? 'none'}-${status}`;
                  return (
                    <DocStatusColumn key={zoneId} droppableId={zoneId} docs={grouped[status] ?? []}
                      onClickDoc={setSelected} onDeleteDoc={handleDelete} />
                  );
                })}
              </div>
            </div>
          );
        })}

        {rows.length === 0 && <div className="text-gray-400 text-sm text-center py-8">{t('Нет документов', 'No documents')}</div>}
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
        onDeleted={() => { setSelected(null); load(); }}
      />
    </div>
  );
}
