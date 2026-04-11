import { useEffect, useState } from 'react';
import { useLangStore } from '../../store/lang.store';

interface SlidePanelProps { open: boolean; onClose: () => void; title: string; children: React.ReactNode; expandable?: boolean; }

export function SlidePanel({ open, onClose, title, children, expandable }: SlidePanelProps) {
  const { t } = useLangStore();
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (fullscreen) setFullscreen(false); else onClose(); } };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, fullscreen]);

  // Reset fullscreen when panel closes
  useEffect(() => { if (!open) setFullscreen(false); }, [open]);

  const panelClass = fullscreen
    ? 'fixed inset-0 bg-white dark:bg-gray-900 z-50'
    : 'fixed top-0 right-0 h-full w-full md:w-[480px] bg-white dark:bg-gray-900 shadow-xl z-50 transform transition-transform duration-300';

  return (
    <>
      {open && !fullscreen && <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />}
      <div className={`${panelClass} ${!fullscreen && !open ? 'translate-x-full' : ''}`}>
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
          <h2 className="text-lg font-semibold truncate flex-1 text-gray-800 dark:text-gray-100">{title}</h2>
          <div className="flex items-center gap-2">
            {expandable && (
              <button
                onClick={() => setFullscreen(!fullscreen)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                title={fullscreen ? t('Свернуть', 'Collapse') : t('На весь экран', 'Fullscreen')}
              >
                {fullscreen ? '⊟' : '⊞'}
              </button>
            )}
            <button onClick={() => { setFullscreen(false); onClose(); }} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl px-1">×</button>
          </div>
        </div>
        <div className="p-4 overflow-y-auto text-gray-800 dark:text-gray-100" style={{ height: 'calc(100% - 57px)', paddingBottom: '2rem' }}>{children}</div>
      </div>
    </>
  );
}
