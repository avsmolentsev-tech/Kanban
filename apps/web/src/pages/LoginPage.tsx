import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { apiPost } from '../api/client';
import { useAuthStore, type AuthUser } from '../store/auth.store';
import { useLangStore } from '../store/lang.store';

type AuthMode = 'login' | 'register' | 'verify' | 'forgot' | 'reset';

export function LoginPage() {
  const { t } = useLangStore();
  const { login } = useAuthStore();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleRegister = async () => {
    const res = await apiPost<{ token: string; user: AuthUser; needsVerification?: boolean }>('/auth/register', { email, password, name });
    login(res.token, res.user);
    if (res.needsVerification) {
      setMode('verify');
      setMessage(t('Код отправлен на ', 'Code sent to ') + email);
    } else {
      window.location.href = '/';
    }
  };

  const handleLogin = async () => {
    const res = await apiPost<{ token: string; user: AuthUser }>('/auth/login', { email, password });
    login(res.token, res.user);
    window.location.href = '/';
  };

  const handleVerify = async () => {
    await apiPost('/auth/verify-email', { email, code });
    setMessage(t('Email подтверждён!', 'Email verified!'));
    setTimeout(() => { window.location.href = '/'; }, 1000);
  };

  const handleResendCode = async () => {
    await apiPost('/auth/resend-code', { email });
    setMessage(t('Код отправлен повторно', 'Code resent'));
  };

  const handleForgotPassword = async () => {
    await apiPost('/auth/forgot-password', { email });
    setMode('reset');
    setMessage(t('Код отправлен на ', 'Code sent to ') + email);
  };

  const handleResetPassword = async () => {
    const res = await apiPost<{ token: string; user: AuthUser }>('/auth/reset-password', { email, code, password: newPassword });
    login(res.token, res.user);
    window.location.href = '/';
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);
    try {
      if (mode === 'login') await handleLogin();
      else if (mode === 'register') await handleRegister();
      else if (mode === 'verify') await handleVerify();
      else if (mode === 'forgot') await handleForgotPassword();
      else if (mode === 'reset') await handleResetPassword();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Ошибка', 'Error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: 'easeOut' }} className="relative overflow-hidden min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] hidden md:block h-[500px] rounded-full bg-indigo-400/15 dark:bg-indigo-400/[0.10]" style={{ animation: 'circleLeft 30s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute -top-20 -right-20 w-[350px] hidden md:block h-[350px] rounded-full bg-purple-400/12 dark:bg-purple-400/[0.08]" style={{ animation: 'circleLeftSlow 26s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] hidden md:block h-[500px] rounded-full bg-indigo-400/[0.14] dark:bg-violet-400/[0.09] blur-[80px]" style={{ animation: 'circleRight 34s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="relative z-10 w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100">Clarity Space</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Your Space for Clarity</p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
          {/* Mode switcher — only for login/register */}
          {(mode === 'login' || mode === 'register') && (
            <div className="flex mb-6 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
              <button
                onClick={() => { setMode('login'); setError(''); setMessage(''); }}
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                  mode === 'login' ? 'bg-white dark:bg-gray-600 text-gray-800 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                {t('Вход', 'Sign In')}
              </button>
              <button
                onClick={() => { setMode('register'); setError(''); setMessage(''); }}
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                  mode === 'register' ? 'bg-white dark:bg-gray-600 text-gray-800 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                {t('Регистрация', 'Sign Up')}
              </button>
            </div>
          )}

          {/* Verify email header */}
          {mode === 'verify' && (
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">📧</div>
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{t('Подтвердите email', 'Verify your email')}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('Введите 6-значный код', 'Enter the 6-digit code')}</p>
            </div>
          )}

          {/* Forgot password header */}
          {mode === 'forgot' && (
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">🔑</div>
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{t('Сброс пароля', 'Reset password')}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('Введите email для получения кода', 'Enter email to receive code')}</p>
            </div>
          )}

          {/* Reset password header */}
          {mode === 'reset' && (
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">🔐</div>
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{t('Новый пароль', 'New password')}</h2>
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            {/* Name — register only */}
            {mode === 'register' && (
              <input
                type="text" placeholder={t('Имя', 'Name')} value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm focus:outline-none focus:border-indigo-400"
              />
            )}

            {/* Email — login, register, forgot */}
            {(mode === 'login' || mode === 'register' || mode === 'forgot') && (
              <input
                type="email" placeholder="Email" value={email}
                onChange={(e) => setEmail(e.target.value)} required
                className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm focus:outline-none focus:border-indigo-400"
              />
            )}

            {/* Password — login, register */}
            {(mode === 'login' || mode === 'register') && (
              <input
                type="password" placeholder={t('Пароль', 'Password')} value={password}
                onChange={(e) => setPassword(e.target.value)} required minLength={6}
                className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm focus:outline-none focus:border-indigo-400"
              />
            )}

            {/* Code — verify, reset */}
            {(mode === 'verify' || mode === 'reset') && (
              <input
                type="text" placeholder={t('6-значный код', '6-digit code')} value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required maxLength={6} inputMode="numeric" autoComplete="one-time-code"
                className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-center text-2xl font-mono tracking-[0.5em] focus:outline-none focus:border-indigo-400"
              />
            )}

            {/* New password — reset */}
            {mode === 'reset' && (
              <input
                type="password" placeholder={t('Новый пароль', 'New password')} value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)} required minLength={6}
                className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm focus:outline-none focus:border-indigo-400"
              />
            )}

            {/* Messages */}
            {message && (
              <div className="text-indigo-600 dark:text-indigo-400 text-sm text-center bg-indigo-50 dark:bg-indigo-900/20 rounded-lg py-2">
                {message}
              </div>
            )}
            {error && (
              <div className="text-red-500 text-sm text-center bg-red-50 dark:bg-red-900/20 rounded-lg py-2">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit" disabled={loading}
              className="w-full py-3 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {loading ? '...'
                : mode === 'login' ? t('Войти', 'Sign In')
                : mode === 'register' ? t('Создать аккаунт', 'Create Account')
                : mode === 'verify' ? t('Подтвердить', 'Verify')
                : mode === 'forgot' ? t('Отправить код', 'Send Code')
                : t('Сменить пароль', 'Reset Password')
              }
            </button>
          </form>

          {/* Links */}
          <div className="mt-4 text-center space-y-2">
            {mode === 'login' && (
              <button onClick={() => { setMode('forgot'); setError(''); setMessage(''); }}
                className="text-xs text-indigo-500 hover:text-indigo-700">
                {t('Забыли пароль?', 'Forgot password?')}
              </button>
            )}
            {mode === 'verify' && (
              <button onClick={handleResendCode} className="text-xs text-indigo-500 hover:text-indigo-700">
                {t('Отправить код повторно', 'Resend code')}
              </button>
            )}
            {(mode === 'forgot' || mode === 'reset' || mode === 'verify') && (
              <button onClick={() => { setMode('login'); setError(''); setMessage(''); setCode(''); }}
                className="block mx-auto text-xs text-gray-400 hover:text-gray-600">
                {t('Назад к входу', 'Back to login')}
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 text-center text-xs text-gray-400 dark:text-gray-500">
          <Link to="/terms" className="hover:text-indigo-500 transition-colors">
            {t('Условия использования', 'Terms of Service')}
          </Link>
          <span className="mx-1.5">|</span>
          <Link to="/privacy" className="hover:text-indigo-500 transition-colors">
            {t('Политика конфиденциальности', 'Privacy Policy')}
          </Link>
        </div>
      </div>
    </motion.div>
  );
}
