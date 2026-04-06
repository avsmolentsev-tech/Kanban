import { FILTER_CONFIG, type FilterValue } from './filterConfig';
import type { Project, Person } from '@pis/shared';

interface FilterBarProps { value: FilterValue; onChange: (v: FilterValue) => void; projects: Project[]; people: Person[]; }

export function FilterBar({ value, onChange, projects, people }: FilterBarProps) {
  const ctx = { projects, people };
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {FILTER_CONFIG.map((f) => {
        if (f.type === 'select' && f.getOptions) {
          const opts = f.getOptions(ctx);
          return (
            <select key={f.key} className="text-sm border border-gray-200 rounded px-2 py-1 bg-white"
              value={(value[f.key] as string | number | undefined) ?? ''}
              onChange={(e) => onChange({ ...value, [f.key]: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">{f.label}</option>
              {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          );
        }
        if (f.type === 'date') {
          return <input key={f.key} type="date" className="text-sm border border-gray-200 rounded px-2 py-1"
            value={(value[f.key] as string | undefined) ?? ''} onChange={(e) => onChange({ ...value, [f.key]: e.target.value || undefined })} />;
        }
        if (f.type === 'boolean') {
          return (
            <label key={f.key} className="flex items-center gap-1 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" checked={(value[f.key] as boolean | undefined) ?? false} onChange={(e) => onChange({ ...value, [f.key]: e.target.checked })} />
              {f.label}
            </label>
          );
        }
        return null;
      })}
      {Object.values(value).some(Boolean) && (
        <button className="text-xs text-gray-400 hover:text-gray-600" onClick={() => onChange({})}>Clear</button>
      )}
    </div>
  );
}
