import type { Editor } from '@tiptap/react';
import {
  Bold, Italic, Strikethrough, Heading1, Heading2, Heading3,
  List, ListOrdered, CheckSquare, Quote, Code2, Minus, Link2, Undo2, Redo2,
} from 'lucide-react';

interface Props {
  editor: Editor | null;
}

function Btn({
  active,
  onClick,
  children,
  title,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded transition-colors cursor-pointer ${
        active
          ? 'bg-indigo-600/20 text-indigo-600 dark:text-indigo-400'
          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700/50'
      }`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div className="w-px h-5 bg-gray-300 dark:bg-gray-700 mx-1" />;
}

export function EditorToolbar({ editor }: Props) {
  if (!editor) return null;

  const addLink = () => {
    const url = window.prompt('URL:');
    if (!url) return;
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-gray-200 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-800/50 flex-wrap">
      <Btn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold (Ctrl+B)">
        <Bold size={16} />
      </Btn>
      <Btn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic (Ctrl+I)">
        <Italic size={16} />
      </Btn>
      <Btn active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough">
        <Strikethrough size={16} />
      </Btn>
      <Sep />
      <Btn active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1">
        <Heading1 size={16} />
      </Btn>
      <Btn active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2">
        <Heading2 size={16} />
      </Btn>
      <Btn active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Heading 3">
        <Heading3 size={16} />
      </Btn>
      <Sep />
      <Btn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet List">
        <List size={16} />
      </Btn>
      <Btn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered List">
        <ListOrdered size={16} />
      </Btn>
      <Btn active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()} title="Checklist">
        <CheckSquare size={16} />
      </Btn>
      <Sep />
      <Btn active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Quote">
        <Quote size={16} />
      </Btn>
      <Btn active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()} title="Code Block">
        <Code2 size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Divider">
        <Minus size={16} />
      </Btn>
      <Sep />
      <Btn active={editor.isActive('link')} onClick={addLink} title="Link (Ctrl+K)">
        <Link2 size={16} />
      </Btn>
      <Sep />
      <Btn onClick={() => editor.chain().focus().undo().run()} title="Undo (Ctrl+Z)">
        <Undo2 size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().redo().run()} title="Redo (Ctrl+Shift+Z)">
        <Redo2 size={16} />
      </Btn>
    </div>
  );
}
