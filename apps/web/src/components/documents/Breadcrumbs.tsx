import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useDocumentsStore } from '../../store/documents.store';
import { useLangStore } from '../../store/lang.store';
import { documentsApi } from '../../api/documents.api';
import type { DocumentNode } from '../../api/documents.api';
import type { Project } from '@pis/shared';

interface Props {
  project: Project | null;
  saving: boolean;
  lastSaved: string | null;
}

interface Crumb {
  label: string;
  onClick?: () => void;
}

function findDocById(docs: DocumentNode[], id: number): DocumentNode | null {
  for (const doc of docs) {
    if (doc.id === id) return doc;
    if (doc.children?.length) {
      const found = findDocById(doc.children as DocumentNode[], id);
      if (found) return found;
    }
  }
  return null;
}

function buildParentChain(docs: DocumentNode[], targetId: number): DocumentNode[] {
  const chain: DocumentNode[] = [];
  let current = findDocById(docs, targetId);
  if (!current) return chain;

  while (current?.parent_id) {
    const parent = findDocById(docs, current.parent_id);
    if (!parent) break;
    chain.unshift(parent);
    current = parent;
  }
  return chain;
}

export function Breadcrumbs({ project, saving, lastSaved }: Props) {
  const { t } = useLangStore();
  const { activeItem, activeDocument, activeMeeting, activeIdea, projectData, setActiveDocument } = useDocumentsStore();
  // Fallback parent chain loaded via API when tree data doesn't have it yet
  const [apiParents, setApiParents] = useState<Array<{ id: number; title: string }>>([]);

  // When active document changes, load parent chain if needed
  useEffect(() => {
    if (!activeDocument?.parent_id) { setApiParents([]); return; }
    const projId = activeDocument.project_id;
    const data = projectData.get(projId);
    // Check if tree data already has the parent chain
    if (data) {
      const parents = buildParentChain(data.documents, activeDocument.id);
      if (parents.length > 0) { setApiParents([]); return; }
    }
    // Fallback: fetch parents via API
    let cancelled = false;
    const loadParents = async () => {
      const chain: Array<{ id: number; title: string }> = [];
      let parentId: number | null = activeDocument.parent_id;
      while (parentId) {
        try {
          const parent = await documentsApi.get(parentId);
          chain.unshift({ id: parent.id, title: parent.title });
          parentId = parent.parent_id;
        } catch { break; }
      }
      if (!cancelled) setApiParents(chain);
    };
    loadParents();
    return () => { cancelled = true; };
  }, [activeDocument?.id, activeDocument?.parent_id, activeDocument?.project_id, projectData]);

  if (!activeItem) return null;

  const crumbs: Crumb[] = [];

  if (project) crumbs.push({ label: project.name });
  else crumbs.push({ label: t('Без проекта', 'No project') });

  if (activeDocument) {
    // Try tree data first, fall back to API-loaded parents
    const projId = activeDocument.project_id;
    const data = projectData.get(projId);
    let parents: Array<{ id: number; title: string }> = [];
    if (data) {
      parents = buildParentChain(data.documents, activeDocument.id);
    }
    if (parents.length === 0 && apiParents.length > 0) {
      parents = apiParents;
    }
    for (const p of parents) {
      const parentId = p.id;
      crumbs.push({
        label: p.title,
        onClick: () => {
          documentsApi.get(parentId).then((doc) => setActiveDocument(doc)).catch(() => {});
        },
      });
    }
    crumbs.push({ label: activeDocument.title });
  } else if (activeMeeting) {
    crumbs.push({ label: t('Встречи', 'Meetings') });
    crumbs.push({ label: activeMeeting.title });
  } else if (activeIdea) {
    crumbs.push({ label: t('Идеи', 'Ideas') });
    crumbs.push({ label: activeIdea.title });
  }

  return (
    <div className="flex items-center gap-1.5 px-4 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-800/30">
      {crumbs.map((c, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight size={12} className="text-gray-600" />}
          {c.onClick ? (
            <button
              onClick={c.onClick}
              className="hover:text-indigo-400 cursor-pointer transition-colors"
            >
              {c.label}
            </button>
          ) : (
            <span className={i === crumbs.length - 1 ? 'text-gray-800 dark:text-gray-200' : ''}>{c.label}</span>
          )}
        </span>
      ))}
      <span className="ml-auto text-[10px] text-gray-500">
        {saving ? t('Сохранение...', 'Saving...') : lastSaved ? t('Сохранено', 'Saved') : ''}
      </span>
    </div>
  );
}
