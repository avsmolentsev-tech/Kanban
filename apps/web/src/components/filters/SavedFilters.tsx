import { useState, useEffect } from 'react';

export interface SavedFilter {
  id: string;
  name: string;
  criteria: FilterCriteria;
}

export interface FilterCriteria {
  statuses?: string[];
  dueDateBefore?: string; // ISO date or 'end_of_week' | 'today'
  dueDateAfter?: string;
  minPriority?: number;
  overdue?: boolean;
}

const STORAGE_KEY = 'pis-saved-filters';

const DEFAULT_PRESETS: SavedFilter[] = [
  {
    id: 'preset-week',
    name: 'Мои на этой неделе',
    criteria: { statuses: ['todo', 'in_progress'], dueDateBefore: 'end_of_week' },
  },
  {
    id: 'preset-high',
    name: 'Высокий приоритет',
    criteria: { minPriority: 4 },
  },
  {
    id: 'preset-overdue',
    name: 'Просрочено',
    criteria: { overdue: true },
  },
];

function getEndOfWeek(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const end = new Date(now);
  end.setDate(now.getDate() + daysUntilSunday);
  return end.toISOString().split('T')[0];
}

function getTodayStr(): string {
  return new Date().toISOString().split('T')[0];
}

export function resolveDueDate(val: string | undefined): string | undefined {
  if (!val) return undefined;
  if (val === 'end_of_week') return getEndOfWeek();
  if (val === 'today') return getTodayStr();
  return val;
}

function loadFilters(): SavedFilter[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return DEFAULT_PRESETS;
}

function saveFilters(filters: SavedFilter[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
}

interface SavedFiltersProps {
  active: string | null;
  onApply: (filter: SavedFilter | null) => void;
}

export function SavedFilters({ active, onApply }: SavedFiltersProps) {
  const [filters, setFilters] = useState<SavedFilter[]>(loadFilters);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    saveFilters(filters);
  }, [filters]);

  const handleAdd = () => {
    if (!newName.trim()) return;
    const newFilter: SavedFilter = {
      id: `custom-${Date.now()}`,
      name: newName.trim(),
      criteria: {},
    };
    setFilters((prev) => [...prev, newFilter]);
    setNewName('');
    setAdding(false);
  };

  const handleRemove = (id: string) => {
    setFilters((prev) => prev.filter((f) => f.id !== id));
    if (active === id) onApply(null);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-gray-400 font-medium">Фильтры:</span>
      {filters.map((f) => (
        <button
          key={f.id}
          onClick={() => onApply(active === f.id ? null : f)}
          className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors ${
            active === f.id
              ? 'bg-indigo-100 border-indigo-300 text-indigo-700'
              : 'bg-white border-gray-200 text-gray-600 hover:border-indigo-200 hover:text-indigo-600'
          }`}
        >
          {f.name}
          {f.id.startsWith('custom-') && (
            <span
              onClick={(e) => { e.stopPropagation(); handleRemove(f.id); }}
              className="ml-0.5 text-gray-400 hover:text-red-500 cursor-pointer"
            >
              &times;
            </span>
          )}
        </button>
      ))}
      {adding ? (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            className="text-xs border border-gray-200 rounded px-2 py-1 w-36"
            placeholder="Название фильтра..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false); }}
          />
          <button onClick={handleAdd} className="text-xs text-indigo-600 font-medium">OK</button>
          <button onClick={() => setAdding(false)} className="text-xs text-gray-400">Отмена</button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="text-xs text-gray-400 hover:text-indigo-600 border border-dashed border-gray-300 rounded-full px-2 py-1 transition-colors"
        >
          + Сохранить
        </button>
      )}
    </div>
  );
}

/** Apply a SavedFilter's criteria to a task list */
export function applyFilterCriteria<T extends { status?: string; due_date?: string | null; priority?: number }>(
  tasks: T[],
  criteria: FilterCriteria
): T[] {
  const today = getTodayStr();
  const endOfWeek = getEndOfWeek();

  return tasks.filter((t) => {
    if (criteria.statuses && criteria.statuses.length > 0) {
      if (!t.status || !criteria.statuses.includes(t.status)) return false;
    }
    if (criteria.dueDateBefore) {
      const limit = criteria.dueDateBefore === 'end_of_week' ? endOfWeek : criteria.dueDateBefore === 'today' ? today : criteria.dueDateBefore;
      if (!t.due_date || t.due_date > limit) return false;
    }
    if (criteria.dueDateAfter) {
      const limit = criteria.dueDateAfter === 'today' ? today : criteria.dueDateAfter;
      if (!t.due_date || t.due_date < limit) return false;
    }
    if (criteria.minPriority) {
      if (!t.priority || t.priority < criteria.minPriority) return false;
    }
    if (criteria.overdue) {
      if (!t.due_date || t.due_date >= today || t.status === 'done') return false;
    }
    return true;
  });
}
