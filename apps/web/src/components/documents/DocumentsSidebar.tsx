import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { DndContext, DragOverlay, rectIntersection, type DragEndEvent, type DragStartEvent, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { useProjectsStore } from '../../store';
import { useDocumentsStore } from '../../store/documents.store';
import { ProjectTreeItem } from './ProjectTreeItem';
import { SidebarSearch } from './SidebarSearch';
import { useLangStore } from '../../store/lang.store';
import { apiPatch } from '../../api/client';
import { FileText, Lightbulb } from 'lucide-react';

export function DocumentsSidebar() {
  const { t } = useLangStore();
  const { projects, fetchProjects } = useProjectsStore();
  const { createDocument, setActiveDocument, expandedProjects, updateDocument } = useDocumentsStore();
  const activeProjects = projects.filter((p) => !p.archived);
  const [dragLabel, setDragLabel] = useState<{ text: string; type: 'doc' | 'idea' } | null>(null);

  const mouseSensor = useSensor(MouseSensor, { activationConstraint: { distance: 8 } });
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } });
  const sensors = useSensors(mouseSensor, touchSensor);

  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    // Find the label from the DOM element
    const el = document.querySelector(`[data-drag-label="${id}"]`);
    const text = el?.textContent ?? '';
    if (id.startsWith('doc-drag-')) setDragLabel({ text, type: 'doc' });
    else if (id.startsWith('idea-drag-')) setDragLabel({ text, type: 'idea' });
  };

  const reloadAllExpanded = async () => {
    for (const pid of useDocumentsStore.getState().expandedProjects) {
      await useDocumentsStore.getState().loadProjectData(pid);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setDragLabel(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    // Document → Project drop (move between projects)
    if (activeId.startsWith('doc-drag-') && overId.startsWith('project-drop-')) {
      const docId = Number(activeId.replace('doc-drag-', ''));
      const targetProjectId = overId === 'project-drop-none' ? null : Number(overId.replace('project-drop-', ''));
      await updateDocument(docId, { project_id: targetProjectId, parent_id: null });
      await reloadAllExpanded();
    }
    // Idea → Project drop
    if (activeId.startsWith('idea-drag-') && overId.startsWith('project-drop-')) {
      const ideaId = Number(activeId.replace('idea-drag-', ''));
      const targetProjectId = overId === 'project-drop-none' ? null : Number(overId.replace('project-drop-', ''));
      await apiPatch(`/ideas/${ideaId}`, { project_id: targetProjectId });
      await reloadAllExpanded();
    }
  };

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Refresh expanded projects: on focus, visibility change, and every 30s polling
  useEffect(() => {
    const refresh = () => {
      for (const pid of useDocumentsStore.getState().expandedProjects) {
        useDocumentsStore.getState().loadProjectData(pid);
      }
    };
    const onFocus = () => refresh();
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    const interval = setInterval(refresh, 30000);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(interval);
    };
  }, []);

  const handleNewDoc = async () => {
    const expandedArr = Array.from(expandedProjects);
    const projectId = expandedArr.length > 0 ? expandedArr[0] : null;
    const doc = await createDocument({ title: t('Новый документ', 'New document'), project_id: projectId });
    setActiveDocument(doc);
  };

  return (
    <div className="w-[280px] min-w-[280px] bg-gray-50 dark:bg-gray-800/50 border-r border-gray-200 dark:border-gray-700/50 flex flex-col h-full">
      <div className="px-3 py-3 border-b border-gray-200 dark:border-gray-700/50">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-500">
          {t('Проекты', 'Projects')}
        </span>
      </div>

      <SidebarSearch />

      <DndContext sensors={sensors} collisionDetection={rectIntersection} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex-1 overflow-y-auto px-1 py-2">
          {activeProjects.map((p) => (
            <ProjectTreeItem key={p.id} project={p} />
          ))}
          <ProjectTreeItem project={null} />
        </div>
        <DragOverlay dropAnimation={null}>
          {dragLabel && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gray-800 text-gray-200 text-sm shadow-lg border border-gray-600/50 opacity-90">
              {dragLabel.type === 'doc' ? <FileText size={14} /> : <Lightbulb size={14} />}
              <span className="truncate max-w-[180px]">{dragLabel.text}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <div className="p-2 border-t border-gray-200 dark:border-gray-700/50">
        <button
          onClick={handleNewDoc}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
        >
          <Plus size={16} />
          {t('Новый документ', 'New document')}
        </button>
      </div>
    </div>
  );
}
