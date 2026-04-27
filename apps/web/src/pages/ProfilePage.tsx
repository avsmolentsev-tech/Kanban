import { useState } from 'react';
import { apiGet, apiPatch } from '../api/client';
import { useAuthStore, type AuthUser } from '../store/auth.store';
import { useLangStore } from '../store/lang.store';
import { User, Lock, MessageCircle, Save, CheckCircle, Smartphone, Copy, Check, HelpCircle, X, Code } from 'lucide-react';

function getWidgetScript(key: string) {
  return `const API_KEY = '${key}';
const API = 'https://kanban.myaipro.ru/v1/widget/today?key=' + API_KEY;

const req = new Request(API);
const data = await req.loadJSON();

if (!data.success) {
  const w = new ListWidget();
  w.backgroundColor = new Color('#0f172a');
  const err = w.addText('Invalid API key');
  err.font = Font.systemFont(12);
  err.textColor = new Color('#ef4444');
  Script.setWidget(w);
  w.presentSmall();
  Script.complete();
  return;
}

const d = data.data;
const w = new ListWidget();
w.backgroundColor = new Color('#0f172a');
w.setPadding(12, 12, 12, 12);

var header = w.addText('CS');
header.font = Font.boldSystemFont(14);
header.textColor = Color.white();
w.addSpacer(4);

if (d.focus) {
  var f = w.addText('\\uD83C\\uDFAF ' + d.focus);
  f.font = Font.mediumSystemFont(11);
  f.textColor = new Color('#fbbf24');
  f.lineLimit = 2;
  w.addSpacer(3);
} else if (d.weekly_goal) {
  var g = w.addText('\\uD83C\\uDFAF ' + d.weekly_goal);
  g.font = Font.mediumSystemFont(11);
  g.textColor = new Color('#a78bfa');
  g.lineLimit = 2;
  w.addSpacer(3);
}

if (d.overdue_count > 0) {
  var o = w.addText('\\u26A0 Overdue: ' + d.overdue_count);
  o.font = Font.systemFont(11);
  o.textColor = new Color('#ef4444');
  w.addSpacer(2);
}

if (d.meetings && d.meetings.length > 0) {
  for (var mi = 0; mi < Math.min(d.meetings.length, 2); mi++) {
    var row = w.addText(d.meetings[mi].title);
    row.font = Font.mediumSystemFont(11);
    row.textColor = new Color('#93c5fd');
    row.lineLimit = 1;
  }
  w.addSpacer(2);
}

for (var ti = 0; ti < Math.min(d.tasks.length, 4); ti++) {
  var trow = w.addText('\\u2022 ' + d.tasks[ti].title);
  trow.font = Font.systemFont(11);
  trow.textColor = new Color('#e2e8f0');
  trow.lineLimit = 1;
}

if (d.habits && d.habits.length > 0) {
  w.addSpacer(4);
  var done = d.habits.filter(function(h) { return h.done; }).length;
  var total = d.habits.length;
  var hText = w.addText(done + '/' + total + ' habits');
  hText.font = Font.systemFont(10);
  hText.textColor = new Color('#f97316');
}

w.addSpacer();
var footer = w.addText(d.date);
footer.font = Font.systemFont(9);
footer.textColor = new Color('#64748b');
footer.rightAlignText();

Script.setWidget(w);
w.presentSmall();
Script.complete();`;
}

function WidgetKeySection() {
  const { t } = useLangStore();
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [guideTab, setGuideTab] = useState<'ios' | 'android'>('ios');

  const generate = async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ api_key: string }>('/widget/key');
      setApiKey(res.api_key);
    } catch {} finally { setLoading(false); }
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => { setCopied(label); setTimeout(() => setCopied(null), 2000); });
  };

  return (
    <>
    <div className="p-4 bg-white dark:bg-gray-800/80 rounded-2xl border border-gray-100 dark:border-gray-700/50">
      <div className="flex items-center gap-2 mb-2">
        <Smartphone size={14} className="text-indigo-500" />
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('Виджет iPhone', 'iPhone Widget')}</span>
      </div>
      {apiKey ? (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">{t('API ключ для Scriptable виджета:', 'API key for Scriptable widget:')}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[11px] bg-gray-100 dark:bg-gray-700 px-3 py-2 rounded-xl text-gray-700 dark:text-gray-300 truncate">{apiKey}</code>
            <button onClick={() => copy(apiKey, 'key')} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition-colors">
              {copied === 'key' ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
            </button>
          </div>
          <button onClick={() => copy(getWidgetScript(apiKey), 'script')}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs font-medium bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors">
            {copied === 'script' ? <><Check size={12} className="text-green-500" /> {t('Скопировано!', 'Copied!')}</> : <><Code size={12} /> {t('Скопировать промт для виджета', 'Copy widget prompt')}</>}
          </button>
          <button onClick={() => setShowGuide(true)}
            className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
            <HelpCircle size={12} /> {t('Как настроить?', 'How to set up?')}
          </button>
        </div>
      ) : (
        <div>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
            {t('Установи Scriptable из App Store, получи API ключ и добавь виджет на домашний экран.', 'Install Scriptable from App Store, get API key and add widget to home screen.')}
          </p>
          <button onClick={generate} disabled={loading}
            className="w-full py-2 px-3 rounded-xl text-sm font-medium bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 disabled:opacity-50">
            {loading ? '...' : t('Получить API ключ', 'Get API key')}
          </button>
        </div>
      )}
    </div>

    {showGuide && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setShowGuide(false)}>
        <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-sm w-full p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">{t('Настройка виджета', 'Widget Setup')}</h3>
            <button onClick={() => setShowGuide(false)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
              <X size={16} />
            </button>
          </div>
          {/* Tab switcher */}
          <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5 mb-1">
            <button onClick={() => setGuideTab('ios')}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${guideTab === 'ios' ? 'bg-white dark:bg-gray-600 text-gray-800 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>
              iPhone
            </button>
            <button onClick={() => setGuideTab('android')}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${guideTab === 'android' ? 'bg-white dark:bg-gray-600 text-gray-800 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>
              Android
            </button>
          </div>

          {guideTab === 'ios' ? (
            <div className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
              <div className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs font-bold">1</span>
                <p>{t('Установи приложение Scriptable из App Store', 'Install Scriptable app from App Store')}</p>
              </div>
              <div className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs font-bold">2</span>
                <p>{t('Нажми "Скопировать промт для виджета", открой Scriptable, создай новый скрипт и вставь код', 'Tap "Copy widget prompt", open Scriptable, create new script and paste the code')}</p>
              </div>
              <div className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs font-bold">3</span>
                <p>{t('Запусти скрипт один раз, затем добавь виджет Scriptable на домашний экран (зажми экран \u2192 "+" \u2192 Scriptable)', 'Run the script once, then add Scriptable widget to home screen (long press \u2192 "+" \u2192 Scriptable)')}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
              <div className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400 flex items-center justify-center text-xs font-bold">1</span>
                <p>{t('Установи "Web Widget" или "Webpage Widget" из Google Play', 'Install "Web Widget" or "Webpage Widget" from Google Play')}</p>
              </div>
              <div className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400 flex items-center justify-center text-xs font-bold">2</span>
                <p>{t('Скопируй ссылку ниже и вставь как URL виджета', 'Copy the link below and paste as widget URL')}</p>
              </div>
              <div className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400 flex items-center justify-center text-xs font-bold">3</span>
                <p>{t('Добавь виджет на домашний экран (зажми экран \u2192 "Виджеты" \u2192 Web Widget)', 'Add widget to home screen (long press \u2192 "Widgets" \u2192 Web Widget)')}</p>
              </div>
              {apiKey && (
                <button onClick={() => copy('https://kanban.myaipro.ru/v1/widget/render?key=' + apiKey, 'android')}
                  className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-medium bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/50 transition-colors">
                  {copied === 'android' ? <><Check size={12} /> {t('Скопировано!', 'Copied!')}</> : <><Copy size={12} /> {t('Скопировать ссылку для Android', 'Copy Android widget URL')}</>}
                </button>
              )}
            </div>
          )}
          <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl">
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {t('Фокус дня берётся из Дневника. Заполни поле "На чём сфокусируюсь" \u2014 оно появится на виджете.', 'Focus of the day comes from Journal. Fill in the focus field \u2014 it will appear on the widget.')}
            </p>
          </div>
          <button onClick={() => setShowGuide(false)}
            className="w-full mt-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium transition-colors">
            {t('Понятно', 'Got it')}
          </button>
        </div>
      </div>
    )}
    </>
  );
}

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
    <div className="relative overflow-hidden flex flex-col h-full pb-20">
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full border-4 border-indigo-400/30 dark:border-white/[0.12]" style={{ animation: 'circleLeft 16s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute -top-20 -right-20 w-[350px] h-[350px] rounded-full border-4 border-purple-400/35 dark:border-white/[0.12]" style={{ animation: 'circleLeftSlow 12s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] h-[500px] rounded-full bg-indigo-400/[0.14] dark:bg-white/[0.06] blur-[80px]" style={{ animation: 'circleRight 20s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="relative z-10 px-4 pt-5 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
            <User size={20} className="text-white" />
          </div>
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('Профиль', 'Profile')}</h1>
        </div>
      </div>

      <div className="relative z-10 flex-1 overflow-auto px-4 space-y-6 max-w-lg">
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

        {/* iPhone Widget */}
        <WidgetKeySection />

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
