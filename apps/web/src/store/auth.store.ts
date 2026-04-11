import { create } from 'zustand';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'user';
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  updateUser: (user: AuthUser) => void;
}

const savedToken = typeof localStorage !== 'undefined' ? localStorage.getItem('auth_token') : null;
const savedUser = typeof localStorage !== 'undefined' ? (() => {
  try { return JSON.parse(localStorage.getItem('auth_user') || 'null'); } catch { return null; }
})() : null;

export const useAuthStore = create<AuthState>((set) => ({
  user: savedUser as AuthUser | null,
  token: savedToken,
  isAuthenticated: !!savedToken && !!savedUser,

  login: (token, user) => {
    localStorage.setItem('auth_token', token);
    localStorage.setItem('auth_user', JSON.stringify(user));
    set({ token, user, isAuthenticated: true });
  },

  logout: () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    set({ token: null, user: null, isAuthenticated: false });
  },

  updateUser: (user) => {
    localStorage.setItem('auth_user', JSON.stringify(user));
    set({ user });
  },
}));
