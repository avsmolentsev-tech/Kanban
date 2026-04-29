import { ChevronRight } from 'lucide-react';
import { useDocumentsStore } from '../../store/documents.store';
import { useLangStore } from '../../store/lang.store';
import type { Project } from '@pis/shared';

interface Props {
  project: Project | null;
  saving: boolean;
  lastSaved: string | null;
}

export function Breadcrumbs({ project, saving, lastSaved }: Props) {
  const { t } = useLangStore();
  const { activeItem, activeDocument, activeMeeting, activeIdea } = useDocumentsStore();

  if (!activeItem) return null;

  const crumbs: string[] = [];
  if (project) crumbs.push(project.name);
  else crumbs.push(t('Без проекта', 'No project'));

  if (activeDocument) {
    crumbs.push(activeDocument.title);
  } else if (activeMeeting) {
    crumbs.push(t('Встречи', 'Meetings'));
    crumbs.push(activeMeeting.title);
  } else if (activeIdea) {
    crumbs.push(t('Идеи', 'Ideas'));
    crumbs.push(activeIdea.title);
  }

  return (
    <div className="flex items-center gap-1.5 px-4 py-2 text-xs text-gray-400 border-b border-gray-700/50 bg-gray-800/30">
      {crumbs.map((c, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight size={12} className="text-gray-600" />}
          <span className={i === crumbs.length - 1 ? 'text-gray-200' : ''}>{c}</span>
        </span>
      ))}
      <span className="ml-auto text-[10px] text-gray-500">
        {saving ? t('Сохранение...', 'Saving...') : lastSaved ? t('Сохранено', 'Saved') : ''}
      </span>
    </div>
  );
}
