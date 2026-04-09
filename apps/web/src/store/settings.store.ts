import { create } from 'zustand';

export type Theme = 'light' | 'dark';
export type Zoom = 'sm' | 'md' | 'lg' | 'xl';

interface SettingsState {
  theme: Theme;
  zoom: Zoom;
  setTheme: (t: Theme) => void;
  setZoom: (z: Zoom) => void;
  toggleTheme: () => void;
}

const ZOOM_SIZES: Record<Zoom, string> = {
  sm: '14px',
  md: '16px',
  lg: '18px',
  xl: '20px',
};

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  if (theme === 'dark') document.documentElement.classList.add('dark');
  else document.documentElement.classList.remove('dark');
}

function applyZoom(zoom: Zoom): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.fontSize = ZOOM_SIZES[zoom];
}

const initialTheme: Theme =
  (typeof localStorage !== 'undefined' && (localStorage.getItem('theme') as Theme | null)) ?? 'light';
const initialZoom: Zoom =
  (typeof localStorage !== 'undefined' && (localStorage.getItem('zoom') as Zoom | null)) ?? 'md';

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
    localStorage.setItem('zoom', zoom);
    applyZoom(zoom);
    set({ zoom });
  },
  toggleTheme: () => {
    const next = get().theme === 'light' ? 'dark' : 'light';
    get().setTheme(next);
  },
}));
