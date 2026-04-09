import { useState, useEffect, useRef } from 'react';
import { useSettingsStore, type Zoom } from '../../store/settings.store';

const ZOOM_LABELS: Record<Zoom, string> = {
  sm: 'Мелко',
  md: 'Обычно',
  lg: 'Крупно',
  xl: 'Очень крупно',
};

export function SettingsMenu() {
  const { theme, zoom, toggleTheme, setZoom } = useSettingsStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
        title="Настройки"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-3 z-50">
          {/* Theme toggle */}
          <div className="mb-3">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">Тема</div>
            <button
              onClick={toggleTheme}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm text-gray-700 dark:text-gray-200"
            >
              <span className="flex items-center gap-2">
                {theme === 'light' ? '☀️' : '🌙'}
                {theme === 'light' ? 'Светлая' : 'Тёмная'}
              </span>
              <span className="text-xs text-gray-400">Переключить</span>
            </button>
          </div>

          {/* Zoom */}
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">Размер</div>
            <div className="grid grid-cols-2 gap-1">
              {(['sm', 'md', 'lg', 'xl'] as Zoom[]).map((z) => (
                <button
                  key={z}
                  onClick={() => setZoom(z)}
                  className={`px-2 py-1.5 rounded-lg text-xs transition-colors ${
                    zoom === z
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
                  }`}
                >
                  {ZOOM_LABELS[z]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
