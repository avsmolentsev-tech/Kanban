import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { FileText, Image, Link2, Minus, CheckSquare, Code2, Quote, Table2 } from 'lucide-react';

export interface SlashMenuItem {
  title: string;
  icon: React.ReactNode;
  command: () => void;
}

interface Props {
  items: SlashMenuItem[];
  command: (item: SlashMenuItem) => void;
}

export interface SlashMenuRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const SlashMenu = forwardRef<SlashMenuRef, Props>(({ items, command }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => setSelectedIndex(0), [items]);

  const selectItem = useCallback(
    (index: number) => {
      const item = items[index];
      if (item) command(item);
    },
    [items, command],
  );

  useImperativeHandle(ref, () => ({
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === 'ArrowUp') {
        setSelectedIndex((i) => (i + items.length - 1) % items.length);
        return true;
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === 'Enter') {
        selectItem(selectedIndex);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) return null;

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden min-w-[200px]">
      {items.map((item, index) => (
        <button
          key={index}
          onClick={() => selectItem(index)}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors cursor-pointer ${
            index === selectedIndex
              ? 'bg-indigo-50 dark:bg-indigo-600/20 text-indigo-700 dark:text-indigo-300'
              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
          }`}
        >
          <span className="text-gray-400 dark:text-gray-500">{item.icon}</span>
          {item.title}
        </button>
      ))}
    </div>
  );
});

SlashMenu.displayName = 'SlashMenu';

export function getSlashMenuItems(query: string, handlers: {
  onChildDocument: () => void;
  onImage: () => void;
  onLink: () => void;
  onDivider: () => void;
  onTaskList: () => void;
  onCodeBlock: () => void;
  onBlockquote: () => void;
  onTable: () => void;
}): SlashMenuItem[] {
  const all: SlashMenuItem[] = [
    { title: 'Дочерний документ', icon: <FileText size={16} />, command: handlers.onChildDocument },
    { title: 'Таблица', icon: <Table2 size={16} />, command: handlers.onTable },
    { title: 'Изображение', icon: <Image size={16} />, command: handlers.onImage },
    { title: 'Ссылка', icon: <Link2 size={16} />, command: handlers.onLink },
    { title: 'Разделитель', icon: <Minus size={16} />, command: handlers.onDivider },
    { title: 'Чекбокс', icon: <CheckSquare size={16} />, command: handlers.onTaskList },
    { title: 'Блок кода', icon: <Code2 size={16} />, command: handlers.onCodeBlock },
    { title: 'Цитата', icon: <Quote size={16} />, command: handlers.onBlockquote },
  ];
  if (!query) return all;
  const q = query.toLowerCase();
  return all.filter((item) => item.title.toLowerCase().includes(q));
}
