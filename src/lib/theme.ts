import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark';
interface ThemeStore { theme: Theme; toggle: () => void }

const apply = (t: Theme) => { document.documentElement.dataset.theme = t; };

export const useTheme = create<ThemeStore>()(
  persist(
    (set, get) => ({
      theme: 'light',
      toggle: () => { const next: Theme = get().theme === 'dark' ? 'light' : 'dark'; apply(next); set({ theme: next }); },
    }),
    { name: 'mw_theme', onRehydrateStorage: () => (s) => apply(s?.theme ?? 'light') },
  ),
);
