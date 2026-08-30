import { useState, useEffect, useRef } from 'react';
import { Lightbulb } from 'lucide-react';
import { useDocumentsStore } from '../../store/documents.store';
import { useLangStore } from '../../store/lang.store';
import type { SidebarIdea } from '../../store/documents.store';

const CATEGORIES = ['business', 'product', 'personal', 'growth'] as const;

interface Props {
  idea: SidebarIdea;
}

export function IdeaEditable({ idea }: Props) {
  const { t } = useLangStore();
  const { updateIdea, setEditingIdea } = useDocumentsStore();
  const [title, setTitle] = useState(idea.title);
  const [body, setBody] = useState(idea.body);
  const [category, setCategory] = useState(idea.category);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTitle(idea.title);
    setBody(idea.body);
    setCategory(idea.category);
  }, [idea.id]);

  const autoSave = (field: string, value: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      updateIdea(idea.id, { [field]: value });
    }, 2000);
  };

  return (
    <div className="px-8 py-6 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3 flex-1">
          <div className="w-8 h-8 rounded-lg bg-amber-600/20 flex items-center justify-center flex-shrink-0">
            <Lightbulb size={16} className="text-amber-400" />
          </div>
          <input
            className="text-2xl font-bold bg-transparent text-gray-800 dark:text-gray-100 focus:outline-none placeholder-gray-400 w-full"
            value={title}
            onChange={(e) => { setTitle(e.target.value); autoSave('title', e.target.value); }}
            placeholder={t('Название идеи', 'Idea title')}
          />
        </div>
        <button
          onClick={() => setEditingIdea(false)}
          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 ml-4 cursor-pointer flex-shrink-0"
        >
          {t('Готово', 'Done')}
        </button>
      </div>
      <div className="flex items-center gap-1.5 mb-6">
        {CATEGORIES.map((c) => (
          <button key={c}
            onClick={() => { setCategory(c); updateIdea(idea.id, { category: c }); }}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors capitalize cursor-pointer ${
              category === c ? 'bg-indigo-600 text-white border-transparent' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700'
            }`}
          >
            {c}
          </button>
        ))}
      </div>
      <textarea
        className="w-full text-sm bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 focus:outline-none focus:border-indigo-500 resize-y"
        style={{ minHeight: '200px' }}
        rows={10}
        value={body}
        onChange={(e) => { setBody(e.target.value); autoSave('body', e.target.value); }}
        placeholder={t('Описание идеи...', 'Describe your idea...')}
      />
    </div>
  );
}
