import { useEffect, useRef, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import LinkExt from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorToolbar } from './EditorToolbar';
import { useDocumentsStore } from '../../store/documents.store';
import { useLangStore } from '../../store/lang.store';
import { ResizableImage } from '../../extensions/resizable-image';
import type { SidebarIdea } from '../../store/documents.store';

const CAT_COLORS: Record<string, string> = {
  business: 'bg-blue-600/20 text-blue-400 border-blue-500/30',
  product: 'bg-purple-600/20 text-purple-400 border-purple-500/30',
  personal: 'bg-emerald-600/20 text-emerald-400 border-emerald-500/30',
  growth: 'bg-amber-600/20 text-amber-400 border-amber-500/30',
};

interface Props {
  idea: SidebarIdea;
}

export function IdeaTiptapEditor({ idea }: Props) {
  const { t } = useLangStore();
  const { updateIdea, setSaving, setLastSaved } = useDocumentsStore();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ideaIdRef = useRef(idea.id);

  useEffect(() => {
    ideaIdRef.current = idea.id;
  }, [idea.id]);

  const saveContent = useCallback(
    (html: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaving(true);
      saveTimer.current = setTimeout(async () => {
        await updateIdea(ideaIdRef.current, { body: html });
        setLastSaved(new Date().toISOString());
        setSaving(false);
      }, 2000);
    },
    [updateIdea, setSaving, setLastSaved],
  );

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
        LinkExt.configure({
          openOnClick: true,
          HTMLAttributes: { class: 'text-indigo-600 dark:text-indigo-400 underline hover:text-indigo-500 dark:hover:text-indigo-300 cursor-pointer' },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Placeholder.configure({
          placeholder: t('Опишите идею...', 'Describe your idea...'),
        }),
        ResizableImage,
      ],
      content: idea.body,
      editorProps: {
        attributes: {
          class: 'prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[400px] px-8 py-4',
        },
      },
      onUpdate: ({ editor: ed }) => {
        saveContent(ed.getHTML());
      },
    },
    [idea.id],
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [title, setTitle] = [idea.title, (newTitle: string) => {
    useDocumentsStore.setState((state) => ({
      activeIdea: state.activeIdea ? { ...state.activeIdea, title: newTitle } : null,
    }));
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      updateIdea(idea.id, { title: newTitle });
    }, 2000);
  }];

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Title */}
      <input
        className="text-2xl font-bold bg-transparent text-gray-800 dark:text-gray-100 px-8 pt-6 pb-2 focus:outline-none placeholder-gray-400 dark:placeholder-gray-600 w-full"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('Название идеи', 'Idea title')}
      />

      {/* Category chips */}
      <div className="flex items-center gap-1.5 px-8 pb-2">
        {(['business', 'product', 'personal', 'growth'] as const).map((c) => (
          <button
            key={c}
            onClick={() => updateIdea(idea.id, { category: c })}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors capitalize cursor-pointer ${
              idea.category === c
                ? CAT_COLORS[c] ?? 'bg-gray-600/20 text-gray-400 border-gray-500/30'
                : 'bg-transparent text-gray-500 dark:text-gray-500 border-gray-200 dark:border-gray-700 hover:border-gray-400'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <EditorToolbar editor={editor} />

      {/* Editor */}
      <div className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
