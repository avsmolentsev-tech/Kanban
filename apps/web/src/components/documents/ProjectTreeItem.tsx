import { ChevronRight, Calendar, Lightbulb, Plus, Trash2 } from 'lucide-react';
import type { Project } from '@pis/shared';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { useDocumentsStore } from '../../store/documents.store';
import { DocumentTreeItem } from './DocumentTreeItem';
import { useLangStore } from '../../store/lang.store';
import { useState } from 'react';

function DraggableIdeaItem({ idea, isActive, onClick, onDelete }: {
  idea: { id: number; title: string };
  isActive: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `idea-drag-${idea.id}` });
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-left text-sm transition-colors cursor-pointer group ${
        isActive
          ? 'bg-indigo-600/20 text-indigo-300'
          : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-700 dark:hover:text-gray-200'
      }`}
      style={{ paddingLeft: '24px', opacity: isDragging ? 0.4 : 1 }}
    >
      <Lightbulb size={13} className="flex-shrink-0 opacity-60" />
      <span className="truncate">{idea.title}</span>
      <Trash2
        size={12}
        className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 transition-all ml-auto"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
      />
    </button>
  );
}

interface Props {
  project: Project | null;
}

export function ProjectTreeItem({ project }: Props) {
  const { t } = useLangStore();
  const {
    expandedProjects, toggleProject, projectData,
    activeItem, setActiveMeeting, setActiveIdea, deleteIdea, searchQuery,
    createDocument, setActiveDocument, createMeeting, createIdea,
  } = useDocumentsStore();
  const projectId = project?.id ?? null;
  const { setNodeRef: setDropRef, isOver: isProjectOver } = useDroppable({ id: `project-drop-${projectId ?? 'none'}` });
  const isExpanded = expandedProjects.has(projectId);
  const data = projectData.get(projectId);

  const query = searchQuery.toLowerCase().trim();
  const filteredData = data && query ? {
    documents: data.documents.filter(d => d.title.toLowerCase().includes(query)),
    meetings: data.meetings.filter(m => m.title.toLowerCase().includes(query)),
    ideas: data.ideas.filter(i => i.title.toLowerCase().includes(query)),
  } : data;

  const hasMatches = filteredData && (filteredData.documents.length > 0 || filteredData.meetings.length > 0 || filteredData.ideas.length > 0);
  const shouldShow = !query || hasMatches;
  const effectiveExpanded = query ? !!hasMatches : isExpanded;

  const [meetingsCollapsed, setMeetingsCollapsed] = useState(false);
  const [ideasCollapsed, setIdeasCollapsed] = useState(false);

  if (!shouldShow) return null;

  return (
    <div className="mb-1">
      <button
        ref={setDropRef}
        onClick={() => toggleProject(projectId)}
        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors cursor-pointer ${isProjectOver ? 'bg-indigo-100 dark:bg-indigo-600/20 ring-2 ring-indigo-500' : ''}`}
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

      {effectiveExpanded && filteredData && (
        <div className="ml-2 mt-0.5">
          <div className="mb-1">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-gray-600 px-2 py-1 font-medium group/docs">
              <span>{t('Документы', 'Documents')}</span>
              <button
                onClick={async (e) => { e.stopPropagation(); const doc = await createDocument({ title: t('Новый документ', 'New document'), project_id: projectId }); setActiveDocument(doc); }}
                className="opacity-0 group-hover/docs:opacity-100 text-gray-400 hover:text-indigo-500 transition-all cursor-pointer"
                title={t('Новый документ', 'New document')}
              >
                <Plus size={14} />
              </button>
            </div>
            {filteredData.documents.map((doc) => (
              <DocumentTreeItem key={doc.id} doc={doc} depth={0} />
            ))}
          </div>

          <div className="mb-1">
            <div className="flex items-center justify-between px-2 py-1 group/meetings">
              <button
                onClick={() => setMeetingsCollapsed(!meetingsCollapsed)}
                className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-gray-600 font-medium cursor-pointer hover:text-gray-400"
              >
                <ChevronRight size={10} className={`transition-transform ${!meetingsCollapsed ? 'rotate-90' : ''}`} />
                {t('Встречи', 'Meetings')} ({filteredData.meetings.length})
              </button>
              <button
                onClick={async (e) => { e.stopPropagation(); await createMeeting(projectId); }}
                className="opacity-0 group-hover/meetings:opacity-100 text-gray-400 hover:text-indigo-500 transition-all cursor-pointer"
                title={t('Новая встреча', 'New meeting')}
              >
                <Plus size={14} />
              </button>
            </div>
            {!meetingsCollapsed && filteredData.meetings.map((m) => (
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

          <div className="mb-1">
            <div className="flex items-center justify-between px-2 py-1 group/ideas">
              <button
                onClick={() => setIdeasCollapsed(!ideasCollapsed)}
                className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-gray-600 font-medium cursor-pointer hover:text-gray-400"
              >
                <ChevronRight size={10} className={`transition-transform ${!ideasCollapsed ? 'rotate-90' : ''}`} />
                {t('Идеи', 'Ideas')} ({filteredData.ideas.length})
              </button>
              <button
                onClick={async (e) => { e.stopPropagation(); await createIdea(projectId); }}
                className="opacity-0 group-hover/ideas:opacity-100 text-gray-400 hover:text-indigo-500 transition-all cursor-pointer"
                title={t('Новая идея', 'New idea')}
              >
                <Plus size={14} />
              </button>
            </div>
            {!ideasCollapsed && filteredData.ideas.map((idea) => (
              <DraggableIdeaItem
                key={idea.id}
                idea={idea}
                isActive={activeItem?.type === 'idea' && activeItem.id === idea.id}
                onClick={() => setActiveIdea(idea)}
                onDelete={() => { if (confirm('Удалить идею?')) deleteIdea(idea.id, projectId); }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
