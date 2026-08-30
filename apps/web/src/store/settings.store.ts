import { create } from 'zustand';

export type Theme = 'light' | 'dark';

interface SettingsState {
  theme: Theme;
  zoom: number; // font-size in px (12-24)
  setTheme: (t: Theme) => void;
  setZoom: (z: number) => void;
  toggleTheme: () => void;
}

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  if (theme === 'dark') document.documentElement.classList.add('dark');
  else document.documentElement.classList.remove('dark');
}

function applyZoom(zoom: number): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.fontSize = `${zoom}px`;
}

const initialTheme: Theme =
  (typeof localStorage !== 'undefined' ? (localStorage.getItem('theme') as Theme | null) : null) ?? 'light';
const savedZoom = typeof localStorage !== 'undefined' ? localStorage.getItem('zoom') : null;
const initialZoom = savedZoom ? Number(savedZoom) : 16;

if (typeof document !== 'undefined') {
  applyTheme(initialTheme);
  applyZoom(initialZoom);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: initialTheme,
  zoom: initialZoom,
  setTheme: (theme) => {
    localStorage.setItem('theme', theme);
    applyTheme(theme);
    set({ theme });
  },
  setZoom: (zoom) => {
    localStorage.setItem('zoom', String(zoom));
    applyZoom(zoom);
    set({ zoom });
  },
  toggleTheme: () => {
    const next = get().theme === 'light' ? 'dark' : 'light';
    get().setTheme(next);
  },
}));
