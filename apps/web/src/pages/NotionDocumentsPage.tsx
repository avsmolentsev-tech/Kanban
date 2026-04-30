import { useCallback, useRef } from 'react';
import { DocumentsSidebar } from '../components/documents/DocumentsSidebar';
import { TiptapEditor } from '../components/documents/TiptapEditor';
import { Breadcrumbs } from '../components/documents/Breadcrumbs';
import { MeetingReadonly } from '../components/documents/MeetingReadonly';
import { MeetingEditable } from '../components/documents/MeetingEditable';
import { IdeaReadonly } from '../components/documents/IdeaReadonly';
import { IdeaEditable } from '../components/documents/IdeaEditable';
import { useDocumentsStore } from '../store/documents.store';
import { useProjectsStore } from '../store';
import { useLangStore } from '../store/lang.store';
import { FileText } from 'lucide-react';

export function NotionDocumentsPage() {
  const { t } = useLangStore();
  const { projects } = useProjectsStore();
  const {
    activeItem, activeDocument, activeMeeting, activeIdea,
    editingMeeting, editingIdea,
    saving, lastSaved, updateDocument,
  } = useDocumentsStore();

  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTitleChange = useCallback(
    (title: string) => {
      if (!activeDocument) return;
      useDocumentsStore.setState((state) => ({
        activeDocument: state.activeDocument ? { ...state.activeDocument, title } : null,
      }));
      if (titleTimer.current) clearTimeout(titleTimer.current);
      titleTimer.current = setTimeout(() => {
        updateDocument(activeDocument.id, { title });
      }, 2000);
    },
    [activeDocument, updateDocument],
  );

  const activeProject = activeDocument
    ? projects.find((p) => p.id === activeDocument.project_id) ?? null
    : activeMeeting
      ? projects.find((p) => p.id === activeMeeting.project_id) ?? null
      : activeIdea
        ? projects.find((p) => p.id === activeIdea.project_id) ?? null
        : null;

  return (
    <div className="relative flex h-full overflow-hidden bg-white dark:bg-gray-900">
      {/* Background spheres — PIS style */}
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full bg-indigo-400/[0.08]" style={{ animation: 'circleLeft 30s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] h-[500px] rounded-full bg-violet-400/[0.06] blur-[80px]" style={{ animation: 'circleRight 34s cubic-bezier(0.45,0,0.55,1) infinite' }} />

      {/* Sidebar */}
      <DocumentsSidebar />

      {/* Editor area */}
      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        {activeItem ? (
          <>
            <Breadcrumbs project={activeProject} saving={saving} lastSaved={lastSaved} />

            {activeItem.type === 'document' && activeDocument && (
              <TiptapEditor
                key={activeDocument.id}
                documentId={activeDocument.id}
                initialContent={activeDocument.body}
                title={activeDocument.title}
                onTitleChange={handleTitleChange}
              />
            )}

            {activeItem.type === 'meeting' && activeMeeting && (
              <div className="flex-1 overflow-y-auto">
                {editingMeeting ? <MeetingEditable meeting={activeMeeting} /> : <MeetingReadonly meeting={activeMeeting} />}
              </div>
            )}

            {activeItem.type === 'idea' && activeIdea && (
              <div className="flex-1 overflow-y-auto">
                {editingIdea ? <IdeaEditable idea={activeIdea} /> : <IdeaReadonly idea={activeIdea} />}
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center mx-auto mb-4">
                <FileText size={28} className="text-gray-500" />
              </div>
              <p className="text-gray-500 text-sm">
                {t('Выберите документ или создайте новый', 'Select a document or create a new one')}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
