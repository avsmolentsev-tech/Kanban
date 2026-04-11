import { create } from 'zustand';

export type Lang = 'ru' | 'en';

interface LangState {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (ru: string, en: string) => string;
}

const initial: Lang = (typeof localStorage !== 'undefined' ? (localStorage.getItem('lang') as Lang | null) : null) ?? 'ru';

export const useLangStore = create<LangState>((set, get) => ({
  lang: initial,
  setLang: (lang) => {
    localStorage.setItem('lang', lang);
    set({ lang });
  },
  t: (ru, en) => get().lang === 'ru' ? ru : en,
}));
