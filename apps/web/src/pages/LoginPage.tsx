import { useState } from 'react';
import { apiPost } from '../api/client';
import { useAuthStore, type AuthUser } from '../store/auth.store';
import { useLangStore } from '../store/lang.store';

export function LoginPage() {
  const { t } = useLangStore();
  const { login } = useAuthStore();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
      const body = mode === 'login' ? { email, password } : { email, password, name };
      const res = await apiPost<{ token: string; user: AuthUser }>(endpoint, body);
      login(res.token, res.user);
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Ошибка', 'Error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative overflow-hidden min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full border border-indigo-400/20 dark:border-white/[0.06]" style={{ animation: 'circleLeft 14s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute -top-20 -right-20 w-[350px] h-[350px] rounded-full border border-purple-400/25 dark:border-white/[0.06]" style={{ animation: 'circleLeftSlow 12s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] h-[500px] rounded-full bg-indigo-400/[0.08] dark:bg-white/[0.03] blur-[80px]" style={{ animation: 'circleRight 16s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="relative z-10 w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100">Clarity Space</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Your Space for Clarity</p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
          {/* Mode switcher */}
          <div className="flex mb-6 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
            <button
              onClick={() => setMode('login')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                mode === 'login' ? 'bg-white dark:bg-gray-600 text-gray-800 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {t('Вход', 'Sign In')}
            </button>
            <button
              onClick={() => setMode('register')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                mode === 'register' ? 'bg-white dark:bg-gray-600 text-gray-800 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {t('Регистрация', 'Sign Up')}
            </button>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === 'register' && (
              <input
                type="text"
                placeholder={t('Имя', 'Name')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm focus:outline-none focus:border-indigo-400"
              />
            )}
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm focus:outline-none focus:border-indigo-400"
            />
            <input
              type="password"
              placeholder={t('Пароль', 'Password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm focus:outline-none focus:border-indigo-400"
            />

            {error && (
              <div className="text-red-500 text-sm text-center bg-red-50 dark:bg-red-900/20 rounded-lg py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {loading
                ? '...'
                : mode === 'login'
                  ? t('Войти', 'Sign In')
                  : t('Создать аккаунт', 'Create Account')
              }
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
