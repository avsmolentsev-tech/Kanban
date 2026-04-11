import { useState, useEffect, useRef } from 'react';
import { useSettingsStore } from '../../store/settings.store';
import { useLangStore, type Lang } from '../../store/lang.store';
import { apiGet, apiPost } from '../../api/client';

export function SettingsMenu() {
  const { theme, zoom, toggleTheme, setZoom } = useSettingsStore();
  const { lang, setLang, t } = useLangStore();
  const [open, setOpen] = useState(false);
  const [gcalConnected, setGcalConnected] = useState<boolean | null>(null);
  const [syncing, setSyncing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (open && gcalConnected === null) {
      apiGet<{ connected: boolean }>('/google-calendar/status').then(d => setGcalConnected(d.connected)).catch(() => setGcalConnected(false));
    }
  }, [open, gcalConnected]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
        title={t('Настройки', 'Settings')}
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
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">{t('Тема', 'Theme')}</div>
            <button
              onClick={toggleTheme}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm text-gray-700 dark:text-gray-200"
            >
              <span className="flex items-center gap-2">
                {theme === 'light' ? '☀️' : '🌙'}
                {theme === 'light' ? t('Светлая', 'Light') : t('Тёмная', 'Dark')}
              </span>
              <span className="text-xs text-gray-400">{t('Переключить', 'Toggle')}</span>
            </button>
          </div>

          {/* Zoom slider with +/- */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-gray-500 dark:text-gray-400">{t('Размер', 'Size')}</span>
              <span className="text-xs text-gray-700 dark:text-gray-200 font-medium">{zoom}px</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setZoom(Math.max(10, zoom - 1))}
                className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 text-lg leading-none font-semibold"
                title={t('Мельче', 'Smaller')}
              >
                −
              </button>
              <input
                type="range"
                min={10}
                max={28}
                step={1}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="zoom-slider flex-1"
              />
              <button
                onClick={() => setZoom(Math.min(28, zoom + 1))}
                className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 text-lg leading-none font-semibold"
                title={t('Крупнее', 'Larger')}
              >
                +
              </button>
            </div>
            <button
              onClick={() => setZoom(16)}
              className="mt-2 w-full text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              {t('Сбросить', 'Reset')}
            </button>
          </div>

          {/* Language */}
          <div className="mb-3">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">{t('Язык', 'Language')}</div>
            <div className="flex gap-1">
              {(['ru', 'en'] as Lang[]).map(l => (
                <button key={l} onClick={() => setLang(l)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                    lang === l ? 'bg-indigo-600 text-white' : 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                  }`}>
                  {l === 'ru' ? 'RU' : 'EN'}
                </button>
              ))}
            </div>
          </div>

          {/* Google Calendar */}
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">Google Calendar</div>
            {gcalConnected ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                  <span>✓</span> {t('Подключён', 'Connected')}
                </div>
                <button
                  onClick={async () => {
                    setSyncing(true);
                    try {
                      const res = await apiPost<{ synced: number; total: number }>('/google-calendar/sync', {});
                      alert(t(`Синхронизировано ${res.synced} из ${res.total} встреч`, `Synced ${res.synced} of ${res.total} meetings`));
                    } catch (e) {
                      alert(t('Ошибка синхронизации', 'Sync error'));
                    } finally { setSyncing(false); }
                  }}
                  disabled={syncing}
                  className="w-full py-2 px-3 rounded-lg text-sm bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 disabled:opacity-50"
                >
                  {syncing ? '...' : t('Синхронизировать встречи', 'Sync meetings')}
                </button>
              </div>
            ) : (
              <a
                href="/v1/google-calendar/auth"
                className="block w-full py-2 px-3 rounded-lg text-sm text-center bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50"
              >
                {t('Подключить Google Calendar', 'Connect Google Calendar')}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
