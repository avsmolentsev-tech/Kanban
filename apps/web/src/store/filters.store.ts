import { create } from 'zustand';

interface FiltersState {
  /** null = show all projects */
  selectedProjectIds: Set<number> | null;
  toggleProject: (id: number, totalCount: number) => void;
  selectAll: () => void;
  selectOnly: (id: number) => void;
}

function loadFromStorage(): Set<number> | null {
  try {
    const raw = localStorage.getItem('pis-project-filter');
    if (!raw) return null;
    const ids = JSON.parse(raw) as number[];
    return new Set(ids);
  } catch {
    return null;
  }
}

function saveToStorage(ids: Set<number> | null): void {
  if (ids === null) {
    localStorage.removeItem('pis-project-filter');
  } else {
    localStorage.setItem('pis-project-filter', JSON.stringify([...ids]));
  }
}

export const useFiltersStore = create<FiltersState>((set) => ({
  selectedProjectIds: loadFromStorage(),

  selectAll: () => {
    saveToStorage(null);
    set({ selectedProjectIds: null });
  },

  selectOnly: (id: number) => {
    const next = new Set([id]);
    saveToStorage(next);
    set({ selectedProjectIds: next });
  },

  toggleProject: (id: number, totalCount: number) => {
    set((state) => {
      let next: Set<number>;
      if (state.selectedProjectIds === null) {
        next = new Set([id]);
      } else {
        next = new Set(state.selectedProjectIds);
        if (next.has(id)) { next.delete(id); } else { next.add(id); }
      }
      const result = next.size === 0 || next.size === totalCount ? null : next;
      saveToStorage(result);
      return { selectedProjectIds: result };
    });
  },
}));
