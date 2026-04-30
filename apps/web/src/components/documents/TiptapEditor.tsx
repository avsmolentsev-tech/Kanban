import { useEffect, useRef, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorToolbar } from './EditorToolbar';
import { useDocumentsStore } from '../../store/documents.store';
import { useLangStore } from '../../store/lang.store';

interface Props {
  documentId: number;
  initialContent: string;
  title: string;
  onTitleChange: (title: string) => void;
}

export function TiptapEditor({ documentId, initialContent, title, onTitleChange }: Props) {
  const { t } = useLangStore();
  const { updateDocument, setSaving, setLastSaved } = useDocumentsStore();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docIdRef = useRef(documentId);

  useEffect(() => {
    docIdRef.current = documentId;
  }, [documentId]);

  const saveContent = useCallback(
    (html: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaving(true);
      saveTimer.current = setTimeout(async () => {
        await updateDocument(docIdRef.current, { body: html });
        setLastSaved(new Date().toISOString());
        setSaving(false);
      }, 2000);
    },
    [updateDocument, setSaving, setLastSaved],
  );

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
        }),
        Link.configure({
          openOnClick: true,
          HTMLAttributes: { class: 'text-indigo-400 underline hover:text-indigo-300 cursor-pointer' },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Placeholder.configure({
          placeholder: t('Начните писать...', 'Start writing...'),
        }),
      ],
      content: initialContent,
      editorProps: {
        attributes: {
          class: 'prose prose-invert prose-sm max-w-none focus:outline-none min-h-[400px] px-8 py-4',
        },
      },
      onUpdate: ({ editor: ed }) => {
        saveContent(ed.getHTML());
      },
    },
    [documentId],
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <input
        className="text-2xl font-bold bg-transparent text-gray-800 dark:text-gray-100 px-8 pt-6 pb-2 focus:outline-none placeholder-gray-400 dark:placeholder-gray-600 w-full"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder={t('Без названия', 'Untitled')}
      />
      <EditorToolbar editor={editor} />
      <div className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
