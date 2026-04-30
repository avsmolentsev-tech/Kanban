import { useEffect } from 'react';
import { Plus } from 'lucide-react';
import { DndContext, rectIntersection, type DragEndEvent, MouseSensor, useSensor, useSensors } from '@dnd-kit/core';
import { useProjectsStore } from '../../store';
import { useDocumentsStore } from '../../store/documents.store';
import { ProjectTreeItem } from './ProjectTreeItem';
import { SidebarSearch } from './SidebarSearch';
import { useLangStore } from '../../store/lang.store';
import { apiPatch } from '../../api/client';

export function DocumentsSidebar() {
  const { t } = useLangStore();
  const { projects, fetchProjects } = useProjectsStore();
  const { createDocument, setActiveDocument, expandedProjects, updateDocument } = useDocumentsStore();
  const activeProjects = projects.filter((p) => !p.archived);

  const mouseSensor = useSensor(MouseSensor, { activationConstraint: { distance: 5 } });
  const sensors = useSensors(mouseSensor);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    // Document → Project drop
    if (activeId.startsWith('doc-drag-') && overId.startsWith('project-drop-')) {
      const docId = Number(activeId.replace('doc-drag-', ''));
      const targetProjectId = overId === 'project-drop-none' ? null : Number(overId.replace('project-drop-', ''));
      await updateDocument(docId, { project_id: targetProjectId, parent_id: null });
    }
    // Document → Document drop (nesting)
    if (activeId.startsWith('doc-drag-') && overId.startsWith('doc-drop-')) {
      const docId = Number(activeId.replace('doc-drag-', ''));
      const parentDocId = Number(overId.replace('doc-drop-', ''));
      if (docId !== parentDocId) {
        await updateDocument(docId, { parent_id: parentDocId });
      }
    }
    // Idea → Project drop
    if (activeId.startsWith('idea-drag-') && overId.startsWith('project-drop-')) {
      const ideaId = Number(activeId.replace('idea-drag-', ''));
      const targetProjectId = overId === 'project-drop-none' ? null : Number(overId.replace('project-drop-', ''));
      await apiPatch(`/ideas/${ideaId}`, { project_id: targetProjectId });
      // Reload expanded projects
      for (const pid of expandedProjects) {
        await useDocumentsStore.getState().loadProjectData(pid);
      }
    }
  };

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

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

      <DndContext sensors={sensors} collisionDetection={rectIntersection} onDragEnd={handleDragEnd}>
        <div className="flex-1 overflow-y-auto px-1 py-2">
          {activeProjects.map((p) => (
            <ProjectTreeItem key={p.id} project={p} />
          ))}
          <ProjectTreeItem project={null} />
        </div>
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
