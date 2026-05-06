import { useState, useEffect } from 'react';
import { HelpCircle } from 'lucide-react';
import { useLangStore } from '../../store/lang.store';

const SHORTCUTS = [
  { key: 'N', ru: 'Новая задача', en: 'New task' },
  { key: '/', ru: 'Поиск', en: 'Search' },
  { key: 'Ctrl+K', ru: 'Быстрая команда', en: 'Quick command' },
  { key: '1', ru: 'Kanban', en: 'Kanban' },
  { key: '2', ru: 'Timeline', en: 'Timeline' },
  { key: '3', ru: 'Проекты', en: 'Projects' },
  { key: '4', ru: 'Встречи', en: 'Meetings' },
  { key: '5', ru: 'Привычки', en: 'Habits' },
  { key: '?', ru: 'Эта подсказка', en: 'This help' },
];

export function HotkeysHelp() {
  const { t } = useLangStore();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('hotkey-help', handler);
    return () => window.removeEventListener('hotkey-help', handler);
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors cursor-pointer"
        title={t('Горячие клавиши', 'Keyboard shortcuts')}
      >
        <HelpCircle size={18} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">{t('Горячие клавиши', 'Keyboard Shortcuts')}</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 cursor-pointer">&times;</button>
            </div>
            <div className="px-6 py-4 space-y-2">
              {SHORTCUTS.map((s) => (
                <div key={s.key} className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-300">{t(s.ru, s.en)}</span>
                  <kbd className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-xs font-mono border border-gray-200 dark:border-gray-600">
                    {s.key}
                  </kbd>
                </div>
              ))}
            </div>
            <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 text-center">
              <span className="text-xs text-gray-400">{t('Нажмите ? в любом месте', 'Press ? anywhere')}</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
