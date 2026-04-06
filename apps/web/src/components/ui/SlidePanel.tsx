import { useEffect } from 'react';

interface SlidePanelProps { open: boolean; onClose: () => void; title: string; children: React.ReactNode; }

export function SlidePanel({ open, onClose, title, children }: SlidePanelProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />}
      <div className={`fixed top-0 right-0 h-full w-96 bg-white shadow-xl z-50 transform transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">x</button>
        </div>
        <div className="p-4 overflow-y-auto h-full pb-16">{children}</div>
      </div>
    </>
  );
}
