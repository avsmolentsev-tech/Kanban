import { useEffect, useState, useRef } from 'react';
import { useLangStore } from '../../store/lang.store';

interface SlidePanelProps { open: boolean; onClose: () => void; title: string; children: React.ReactNode; expandable?: boolean; }

export function SlidePanel({ open, onClose, title, children, expandable }: SlidePanelProps) {
  const { t } = useLangStore();
  const [fullscreen, setFullscreen] = useState(false);
  const [swipeX, setSwipeX] = useState(0);
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const isHorizontal = useRef<boolean | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (fullscreen) setFullscreen(false); else onClose(); } };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, fullscreen]);

  useEffect(() => { if (!open) { setFullscreen(false); setSwipeX(0); } }, [open]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (fullscreen) return;
    startX.current = e.touches[0]!.clientX;
    startY.current = e.touches[0]!.clientY;
    isHorizontal.current = null;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (fullscreen || startX.current === null || startY.current === null) return;
    const dx = e.touches[0]!.clientX - startX.current;
    const dy = e.touches[0]!.clientY - startY.current;

    // Determine direction on first significant move
    if (isHorizontal.current === null) {
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        isHorizontal.current = Math.abs(dx) > Math.abs(dy);
      }
      return;
    }

    if (!isHorizontal.current) return; // vertical scroll, ignore
    if (dx > 0) setSwipeX(dx); // only swipe right
  };

  const handleTouchEnd = () => {
    if (swipeX > 100) {
      onClose();
    }
    setSwipeX(0);
    startX.current = null;
    startY.current = null;
    isHorizontal.current = null;
  };

  const panelClass = fullscreen
    ? 'fixed inset-0 bg-white dark:bg-gray-900 z-50'
    : 'fixed top-0 right-0 h-full w-full md:w-[480px] bg-white dark:bg-gray-900 shadow-xl z-50 transition-transform duration-300';

  const translateX = !fullscreen && open ? swipeX : (!fullscreen && !open ? window.innerWidth : 0);

  return (
    <>
      {open && !fullscreen && (
        <div
          className="fixed inset-0 bg-black/20 z-40 transition-opacity"
          style={{ opacity: swipeX > 0 ? Math.max(0, 1 - swipeX / 200) : 1 }}
          onClick={onClose}
        />
      )}
      <div
        className={panelClass}
        style={!fullscreen ? { transform: `translateX(${translateX}px)`, transition: swipeX > 0 ? 'none' : 'transform 0.3s ease-out' } : undefined}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Swipe indicator */}
        {open && !fullscreen && (
          <div className="absolute left-2 top-1/2 -translate-y-1/2 w-1 h-12 rounded-full bg-gray-300 dark:bg-gray-600 opacity-30" />
        )}

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
