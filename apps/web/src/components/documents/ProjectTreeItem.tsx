import { ChevronRight, Calendar, Lightbulb } from 'lucide-react';
import type { Project } from '@pis/shared';
import { useDocumentsStore } from '../../store/documents.store';
import { DocumentTreeItem } from './DocumentTreeItem';
import { useLangStore } from '../../store/lang.store';
import { useState } from 'react';

interface Props {
  project: Project | null;
}

export function ProjectTreeItem({ project }: Props) {
  const { t } = useLangStore();
  const {
    expandedProjects, toggleProject, projectData,
    activeItem, setActiveMeeting, setActiveIdea,
  } = useDocumentsStore();
  const projectId = project?.id ?? null;
  const isExpanded = expandedProjects.has(projectId);
  const data = projectData.get(projectId);

  const [meetingsCollapsed, setMeetingsCollapsed] = useState(false);
  const [ideasCollapsed, setIdeasCollapsed] = useState(false);

  return (
    <div className="mb-1">
      <button
        onClick={() => toggleProject(projectId)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
      >
        <ChevronRight
          size={14}
          className={`text-gray-500 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
        />
        <div
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: project?.color ?? '#9ca3af' }}
        />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">
          {project?.name ?? t('Без проекта', 'No project')}
        </span>
      </button>

      {isExpanded && data && (
        <div className="ml-2 mt-0.5">
          {data.documents.length > 0 && (
            <div className="mb-1">
              <div className="text-[10px] uppercase tracking-wider text-gray-600 px-2 py-1 font-medium">
                {t('Документы', 'Documents')}
              </div>
              {data.documents.map((doc) => (
                <DocumentTreeItem key={doc.id} doc={doc} depth={0} />
              ))}
            </div>
          )}

          {data.meetings.length > 0 && (
            <div className="mb-1">
              <button
                onClick={() => setMeetingsCollapsed(!meetingsCollapsed)}
                className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-gray-600 px-2 py-1 font-medium cursor-pointer hover:text-gray-400"
              >
                <ChevronRight size={10} className={`transition-transform ${!meetingsCollapsed ? 'rotate-90' : ''}`} />
                {t('Встречи', 'Meetings')} ({data.meetings.length})
              </button>
              {!meetingsCollapsed && data.meetings.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setActiveMeeting(m)}
                  className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-left text-sm transition-colors cursor-pointer ${
                    activeItem?.type === 'meeting' && activeItem.id === m.id
                      ? 'bg-indigo-600/20 text-indigo-300'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}
                  style={{ paddingLeft: '24px' }}
                >
                  <Calendar size={13} className="flex-shrink-0 opacity-60" />
                  <span className="truncate flex-1">{m.title}</span>
                  <span className="text-[10px] text-gray-600 flex-shrink-0">
                    {m.date.split('T')[0]?.slice(5)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {data.ideas.length > 0 && (
            <div className="mb-1">
              <button
                onClick={() => setIdeasCollapsed(!ideasCollapsed)}
                className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-gray-600 px-2 py-1 font-medium cursor-pointer hover:text-gray-400"
              >
                <ChevronRight size={10} className={`transition-transform ${!ideasCollapsed ? 'rotate-90' : ''}`} />
                {t('Идеи', 'Ideas')} ({data.ideas.length})
              </button>
              {!ideasCollapsed && data.ideas.map((idea) => (
                <button
                  key={idea.id}
                  onClick={() => setActiveIdea(idea)}
                  className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-left text-sm transition-colors cursor-pointer ${
                    activeItem?.type === 'idea' && activeItem.id === idea.id
                      ? 'bg-indigo-600/20 text-indigo-300'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}
                  style={{ paddingLeft: '24px' }}
                >
                  <Lightbulb size={13} className="flex-shrink-0 opacity-60" />
                  <span className="truncate">{idea.title}</span>
                </button>
              ))}
            </div>
          )}

          {data.documents.length === 0 && data.meetings.length === 0 && data.ideas.length === 0 && (
            <div className="text-xs text-gray-600 px-4 py-2">{t('Пусто', 'Empty')}</div>
          )}
        </div>
      )}
    </div>
  );
}
