import { useFiltersStore } from '../../store';
import type { Project } from '@pis/shared';
import { useLangStore } from '../../store/lang.store';

interface Props {
  projects: Project[];
}

export function ProjectFilter({ projects }: Props) {
  const { selectedProjectIds, selectAll, toggleProject } = useFiltersStore();
  const { t } = useLangStore();

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <button
        onClick={selectAll}
        className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${selectedProjectIds === null ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'}`}
      >{t('Все', 'All')}</button>
      {projects.map((p) => {
        const active = selectedProjectIds === null || selectedProjectIds.has(p.id);
        const isFiltered = selectedProjectIds !== null;
        return (
          <button key={p.id}
            onClick={() => toggleProject(p.id, projects.length)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors flex items-center gap-1 ${active && isFiltered ? 'text-white border-transparent' : !isFiltered ? 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400' : 'bg-white text-gray-400 border-gray-200'}`}
            style={active && isFiltered ? { backgroundColor: p.color } : undefined}
          >
            <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: p.color }} />
            {p.name}
          </button>
        );
      })}
    </div>
  );
}
