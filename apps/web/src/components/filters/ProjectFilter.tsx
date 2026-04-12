import { useState, useRef, useEffect } from 'react';
import { useFiltersStore } from '../../store';
import type { Project } from '@pis/shared';
import { useLangStore } from '../../store/lang.store';
import { Filter, Check, X } from 'lucide-react';

interface Props {
  projects: Project[];
}

export function ProjectFilter({ projects }: Props) {
  const { selectedProjectIds, selectAll, toggleProject } = useFiltersStore();
  const { t } = useLangStore();
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

  const isAll = selectedProjectIds === null;
  const count = selectedProjectIds ? selectedProjectIds.size : projects.length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border transition-colors font-medium ${
          isAll
            ? 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600'
            : 'bg-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-500/20'
        }`}
      >
        <Filter size={12} />
        {isAll ? t('Все проекты', 'All projects') : `${count} ${t('из', 'of')} ${projects.length}`}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden">
          {/* All button */}
          <button
            onClick={() => { selectAll(); setOpen(false); }}
            className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${
              isAll ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            {isAll && <Check size={14} className="text-indigo-600" />}
            <span className={isAll ? 'font-semibold' : 'ml-[22px]'}>{t('Все проекты', 'All projects')}</span>
          </button>

          <div className="border-t border-gray-100 dark:border-gray-700" />

          {/* Project list */}
          <div className="max-h-[280px] overflow-auto py-1">
            {projects.map(p => {
              const active = selectedProjectIds !== null && selectedProjectIds.has(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => toggleProject(p.id, projects.length)}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                  <div className={`w-4 h-4 rounded-md border-2 flex items-center justify-center transition-colors ${
                    active ? 'border-transparent' : 'border-gray-300 dark:border-gray-500'
                  }`} style={active ? { backgroundColor: p.color } : undefined}>
                    {active && <Check size={10} className="text-white" strokeWidth={3} />}
                  </div>
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                  <span className="truncate">{p.name}</span>
                </button>
              );
            })}
          </div>

          {/* Close */}
          {selectedProjectIds !== null && (
            <>
              <div className="border-t border-gray-100 dark:border-gray-700" />
              <button
                onClick={() => { selectAll(); setOpen(false); }}
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                <X size={12} /> {t('Сбросить фильтр', 'Clear filter')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
