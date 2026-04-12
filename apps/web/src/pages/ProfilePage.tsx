import { useState } from 'react';
import { apiPatch } from '../api/client';
import { useAuthStore, type AuthUser } from '../store/auth.store';
import { useLangStore } from '../store/lang.store';
import { User, Lock, MessageCircle, Save, CheckCircle } from 'lucide-react';

export function ProfilePage() {
  const { t } = useLangStore();
  const { user, updateUser, logout } = useAuthStore();
  const [name, setName] = useState(user?.name ?? '');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const body: Record<string, string> = {};
      if (name.trim() && name !== user?.name) body['name'] = name.trim();
      if (password.length >= 6) body['password'] = password;
      if (Object.keys(body).length === 0) { setSaving(false); return; }

      const res = await apiPatch<{ token: string; user: AuthUser }>('/auth/me', body);
      updateUser(res.user);
      localStorage.setItem('auth_token', res.token);
      setPassword('');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Ошибка', 'Error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full pb-20">
      <div className="px-4 pt-5 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
            <User size={20} className="text-white" />
          </div>
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('Профиль', 'Profile')}</h1>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 space-y-6 max-w-lg">
        {/* Avatar & info */}
        <div className="flex items-center gap-4 p-4 bg-white dark:bg-gray-800/80 rounded-2xl border border-gray-100 dark:border-gray-700/50">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-indigo-500/20">
            {(user?.name || user?.email || '?')[0]?.toUpperCase()}
          </div>
          <div>
            <div className="font-semibold text-gray-800 dark:text-gray-100">{user?.name}</div>
            <div className="text-sm text-gray-400">{user?.email}</div>
            <div className="text-xs text-indigo-500 mt-0.5">{user?.role === 'admin' ? 'Admin' : 'User'}</div>
          </div>
        </div>

        {/* Name */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
            <User size={12} /> {t('Имя', 'Name')}
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-2xl bg-gray-50 dark:bg-gray-700/50 text-gray-800 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          />
        </div>

        {/* Password */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
            <Lock size={12} /> {t('Новый пароль', 'New password')}
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('Минимум 6 символов', 'Minimum 6 characters')}
            className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-2xl bg-gray-50 dark:bg-gray-700/50 text-gray-800 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          />
        </div>

        {/* Telegram ID */}
        <div className="p-4 bg-white dark:bg-gray-800/80 rounded-2xl border border-gray-100 dark:border-gray-700/50">
          <div className="flex items-center gap-2 mb-2">
            <MessageCircle size={14} className="text-blue-500" />
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Telegram</span>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {t(
              'Привязка через бот: откройте @MyBestKanban_bot → /start → "У меня есть аккаунт"',
              'Link via bot: open @MyBestKanban_bot → /start → "I have an account"'
            )}
          </p>
        </div>

        {error && (
          <div className="text-red-500 text-sm text-center bg-red-50 dark:bg-red-900/20 rounded-xl py-2">
            {error}
          </div>
        )}

        {/* Save button */}
        <button
          onClick={save}
          disabled={saving}
          className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-sm font-semibold disabled:opacity-50 shadow-lg shadow-indigo-500/25 transition-all flex items-center justify-center gap-2"
        >
          {saved ? <><CheckCircle size={16} /> {t('Сохранено!', 'Saved!')}</>
           : saving ? '...'
           : <><Save size={16} /> {t('Сохранить', 'Save')}</>}
        </button>
      </div>
    </div>
  );
}
