import { useEffect } from 'react';
import { Plus } from 'lucide-react';
import { useProjectsStore } from '../../store';
import { useDocumentsStore } from '../../store/documents.store';
import { ProjectTreeItem } from './ProjectTreeItem';
import { SidebarSearch } from './SidebarSearch';
import { useLangStore } from '../../store/lang.store';

export function DocumentsSidebar() {
  const { t } = useLangStore();
  const { projects, fetchProjects } = useProjectsStore();
  const { createDocument, setActiveDocument, expandedProjects } = useDocumentsStore();
  const activeProjects = projects.filter((p) => !p.archived);

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

      <div className="flex-1 overflow-y-auto px-1 py-2">
        {activeProjects.map((p) => (
          <ProjectTreeItem key={p.id} project={p} />
        ))}
        <ProjectTreeItem project={null} />
      </div>

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
