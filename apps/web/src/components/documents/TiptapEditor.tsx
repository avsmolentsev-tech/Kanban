import { useEffect, useRef, useCallback, useState } from 'react';
import { useEditor, EditorContent, ReactRenderer } from '@tiptap/react';
import { Plus } from 'lucide-react';
import StarterKit from '@tiptap/starter-kit';
import LinkExt from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import tippy, { type Instance as TippyInstance } from 'tippy.js';
import { EditorToolbar } from './EditorToolbar';
import { SlashMenu, getSlashMenuItems, type SlashMenuRef } from './SlashMenu';
import { SlashCommands } from '../../extensions/slash-commands';
import { ResizableImage } from '../../extensions/resizable-image';
import { useDocumentsStore } from '../../store/documents.store';
import { useLangStore } from '../../store/lang.store';
import { apiClient } from '../../api/client';

interface Props {
  documentId: number;
  initialContent: string;
  title: string;
  onTitleChange: (title: string) => void;
}

export function TiptapEditor({ documentId, initialContent, title, onTitleChange }: Props) {
  const { t } = useLangStore();
  const { updateDocument, setSaving, setLastSaved, createDocument, setActiveDocument } = useDocumentsStore();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docIdRef = useRef(documentId);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const uploadImage = useCallback(async (file: File): Promise<string | null> => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await apiClient.post(`/documents/${docIdRef.current}/attachments`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const attachment = res.data?.data;
      if (attachment?.filename) {
        return `/v1/documents/attachments/file/${attachment.filename}`;
      }
    } catch (err) {
      console.warn('Image upload failed:', err);
    }
    return null;
  }, []);

  const handleImageInsert = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const editorRef = useRef<ReturnType<typeof useEditor>>(null);

  const handleChildDocument = useCallback(async () => {
    const activeDoc = useDocumentsStore.getState().activeDocument;
    if (!activeDoc) return;
    const child = await createDocument({
      title: t('Новый документ', 'New document'),
      project_id: activeDoc.project_id,
      parent_id: activeDoc.id,
    });
    const ed = editorRef.current;
    if (ed) {
      ed.chain().focus().insertContent(
        `<p><a href="#doc-${child.id}" class="child-doc-link" data-doc-id="${child.id}">📄 ${child.title}</a></p>`
      ).run();
    }
    setActiveDocument(child);
  }, [createDocument, setActiveDocument, t]);

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
          placeholder: t('Начните писать или нажмите / для команд...', 'Start writing or press / for commands...'),
        }),
        ResizableImage,
        SlashCommands.configure({
          suggestion: {
            char: '/',
            startOfLine: false,
            items: ({ query }: { query: string }) => {
              return getSlashMenuItems(query, {
                onChildDocument: () => handleChildDocument(),
                onImage: () => handleImageInsert(),
                onLink: () => {
                  const url = window.prompt('URL:');
                  if (url) editorRef.current?.chain().focus().setLink({ href: url }).run();
                },
                onDivider: () => editorRef.current?.chain().focus().setHorizontalRule().run(),
                onTaskList: () => editorRef.current?.chain().focus().toggleTaskList().run(),
                onCodeBlock: () => editorRef.current?.chain().focus().toggleCodeBlock().run(),
                onBlockquote: () => editorRef.current?.chain().focus().toggleBlockquote().run(),
              });
            },
            render: () => {
              let component: ReactRenderer<SlashMenuRef> | null = null;
              let popup: TippyInstance[] | null = null;

              return {
                onStart: (props: any) => {
                  component = new ReactRenderer(SlashMenu, { props, editor: props.editor });
                  popup = tippy('body', {
                    getReferenceClientRect: props.clientRect,
                    appendTo: () => document.body,
                    content: component.element,
                    showOnCreate: true,
                    interactive: true,
                    trigger: 'manual',
                    placement: 'bottom-start',
                    theme: 'slash-menu',
                  });
                },
                onUpdate: (props: any) => {
                  component?.updateProps(props);
                  popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect });
                },
                onKeyDown: (props: any) => {
                  if (props.event.key === 'Escape') {
                    popup?.[0]?.hide();
                    return true;
                  }
                  return component?.ref?.onKeyDown(props.event) ?? false;
                },
                onExit: () => {
                  popup?.[0]?.destroy();
                  component?.destroy();
                },
              };
            },
          },
        }),
      ],
      content: initialContent,
      editorProps: {
        attributes: {
          class: 'prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[400px] px-8 py-4',
        },
        handleDrop: (_view, event) => {
          const files = event.dataTransfer?.files;
          if (files && files.length > 0) {
            const file = files[0]!;
            if (file.type.startsWith('image/')) {
              event.preventDefault();
              uploadImage(file).then((url) => {
                if (url) editorRef.current?.chain().focus().setImage({ src: url }).run();
              });
              return true;
            }
          }
          return false;
        },
        handlePaste: (_view, event) => {
          const files = event.clipboardData?.files;
          if (files && files.length > 0) {
            const file = files[0]!;
            if (file.type.startsWith('image/')) {
              event.preventDefault();
              uploadImage(file).then((url) => {
                if (url) editorRef.current?.chain().focus().setImage({ src: url }).run();
              });
              return true;
            }
          }
          return false;
        },
      },
      onUpdate: ({ editor: ed }) => {
        saveContent(ed.getHTML());
      },
    },
    [documentId],
  );

  // Keep ref in sync for slash menu handlers
  useEffect(() => {
    (editorRef as any).current = editor;
  }, [editor]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await uploadImage(file);
    if (url) editorRef.current?.chain().focus().setImage({ src: url }).run();
    e.target.value = '';
  }, [uploadImage]);

  // Floating "+" button state
  const [plusBtnPos, setPlusBtnPos] = useState<{ top: number; visible: boolean }>({ top: 0, visible: false });
  const editorContainerRef = useRef<HTMLDivElement>(null);

  const handlePlusClick = useCallback(() => {
    if (!editor) return;
    // Insert "/" to trigger slash menu
    editor.chain().focus().insertContent('/').run();
  }, [editor]);

  // Track cursor position to show "+" on empty lines
  useEffect(() => {
    if (!editor) return;
    const updatePlusBtn = () => {
      const { $anchor } = editor.state.selection;
      const node = $anchor.parent;
      const isEmptyParagraph = node.type.name === 'paragraph' && node.content.size === 0;

      if (isEmptyParagraph && editorContainerRef.current) {
        const coords = editor.view.coordsAtPos($anchor.pos);
        const containerRect = editorContainerRef.current.getBoundingClientRect();
        setPlusBtnPos({ top: coords.top - containerRect.top, visible: true });
      } else {
        setPlusBtnPos((prev) => prev.visible ? { ...prev, visible: false } : prev);
      }
    };

    editor.on('selectionUpdate', updatePlusBtn);
    editor.on('update', updatePlusBtn);
    return () => {
      editor.off('selectionUpdate', updatePlusBtn);
      editor.off('update', updatePlusBtn);
    };
  }, [editor]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <input
        className="text-2xl font-bold bg-transparent text-gray-800 dark:text-gray-100 px-8 pt-6 pb-2 focus:outline-none placeholder-gray-400 dark:placeholder-gray-600 w-full"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder={t('Без названия', 'Untitled')}
      />
      <EditorToolbar editor={editor} />
      <div className="flex-1 overflow-y-auto relative" ref={editorContainerRef}>
        {/* Floating "+" button on empty lines */}
        {plusBtnPos.visible && (
          <button
            onClick={handlePlusClick}
            className="absolute left-1 z-10 w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:text-indigo-500 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
            style={{ top: `${plusBtnPos.top}px` }}
            title={t('Вставить блок', 'Insert block')}
          >
            <Plus size={16} />
          </button>
        )}
        <EditorContent editor={editor} />
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
    </div>
  );
}
