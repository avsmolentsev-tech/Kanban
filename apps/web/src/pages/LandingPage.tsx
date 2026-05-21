import { Link } from 'react-router-dom';
import { useLangStore } from '../store/lang.store';
import {
  Mic, Columns3, Bot, Flame, CalendarDays, Link2,
  Users, Lightbulb, BarChart3, ArrowRight, ChevronDown,
  Sparkles, CheckCircle2, Zap,
} from 'lucide-react';

const features = (t: (ru: string, en: string) => string) => [
  {
    icon: Mic,
    title: t('AI-транскрибация встреч', 'AI Meeting Transcription'),
    desc: t(
      'Записывай встречи, получай резюме, задачи и Q&A автоматически',
      'Record meetings, get summaries, tasks and Q&A automatically',
    ),
  },
  {
    icon: Columns3,
    title: t('Kanban + Gantt + Timeline', 'Kanban + Gantt + Timeline'),
    desc: t('Управляй задачами как удобно', 'Manage tasks your way'),
  },
  {
    icon: Bot,
    title: t('AI-ассистент в Telegram', 'AI Assistant in Telegram'),
    desc: t(
      'Голосовые команды, создание задач, ежедневный брифинг',
      'Voice commands, task creation, daily briefing',
    ),
  },
  {
    icon: Flame,
    title: t('Трекер привычек', 'Habit Tracker'),
    desc: t(
      'Ежедневные привычки с стриками и статистикой',
      'Daily habits with streaks and statistics',
    ),
  },
  {
    icon: CalendarDays,
    title: t('Умный календарь', 'Smart Calendar'),
    desc: t(
      'День, 3 дня, неделя, месяц с Google Calendar',
      'Day, 3-day, week, month with Google Calendar',
    ),
  },
  {
    icon: Link2,
    title: t('Obsidian синхронизация', 'Obsidian Sync'),
    desc: t('Все данные в твоём vault', 'All data in your vault'),
  },
  {
    icon: Users,
    title: t('CRM для контактов', 'Contact CRM'),
    desc: t(
      'Люди, компании, проекты, история встреч',
      'People, companies, projects, meeting history',
    ),
  },
  {
    icon: Lightbulb,
    title: t('Банк идей', 'Idea Bank'),
    desc: t(
      'Сохраняй идеи, привязывай к проектам',
      'Save ideas, link them to projects',
    ),
  },
  {
    icon: BarChart3,
    title: t('Аналитика продуктивности', 'Productivity Analytics'),
    desc: t(
      'AI анализ, план на день, мотивация',
      'AI analysis, daily plan, motivation',
    ),
  },
];

const steps = (t: (ru: string, en: string) => string) => [
  {
    num: '01',
    icon: Mic,
    title: t('Запиши', 'Record'),
    desc: t(
      'Запиши встречу или надиктуй мысль',
      'Record a meeting or dictate a thought',
    ),
  },
  {
    num: '02',
    icon: Sparkles,
    title: t('AI обработает', 'AI Processes'),
    desc: t(
      'AI создаст задачи, резюме и план действий',
      'AI creates tasks, summary and action plan',
    ),
  },
  {
    num: '03',
    icon: CheckCircle2,
    title: t('Отслеживай', 'Track'),
    desc: t(
      'Отслеживай прогресс в Kanban, календаре или Telegram',
      'Track progress in Kanban, calendar or Telegram',
    ),
  },
];

export function LandingPage() {
  const { t } = useLangStore();

  const scrollToFeatures = () => {
    document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 overflow-x-hidden">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden">
        {/* Animated background circles */}
        <div
          className="pointer-events-none absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full bg-indigo-400/20 dark:bg-indigo-400/[0.08] blur-[40px]"
          style={{ animation: 'circleLeft 30s cubic-bezier(0.45,0,0.55,1) infinite' }}
        />
        <div
          className="pointer-events-none absolute -top-20 left-1/4 w-[400px] h-[400px] rounded-full bg-purple-400/15 dark:bg-purple-400/[0.06] blur-[60px]"
          style={{ animation: 'circleLeftSlow 26s cubic-bezier(0.45,0,0.55,1) infinite' }}
        />
        <div
          className="pointer-events-none absolute bottom-20 -left-40 w-[550px] h-[550px] rounded-full bg-indigo-400/[0.14] dark:bg-violet-400/[0.07] blur-[80px]"
          style={{ animation: 'circleRight 34s cubic-bezier(0.45,0,0.55,1) infinite' }}
        />
        <div
          className="pointer-events-none absolute bottom-40 right-1/4 w-[350px] h-[350px] rounded-full bg-pink-400/10 dark:bg-pink-400/[0.05] blur-[70px]"
          style={{ animation: 'circleRightSlow 38s cubic-bezier(0.45,0,0.55,1) infinite' }}
        />

        <div className="relative z-10 text-center max-w-3xl mx-auto">
          {/* Logo */}
          <div className="inline-flex items-center gap-3 mb-8">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-xl shadow-indigo-500/25">
              <span className="text-white font-bold text-xl">CS</span>
            </div>
          </div>

          <h1 className="text-5xl sm:text-7xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 dark:from-indigo-400 dark:via-purple-400 dark:to-indigo-400 bg-clip-text text-transparent leading-tight">
            Clarity Space
          </h1>

          <p className="mt-4 text-xl sm:text-2xl font-medium text-gray-600 dark:text-gray-300">
            {t('Ваше пространство для ясности', 'Your Space for Clarity')}
          </p>

          <p className="mt-6 text-base sm:text-lg text-gray-500 dark:text-gray-400 max-w-xl mx-auto leading-relaxed">
            {t(
              'AI-ассистент для управления задачами, встречами, привычками и идеями',
              'AI assistant for managing tasks, meetings, habits and ideas',
            )}
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/login"
              className="inline-flex items-center gap-2 px-8 py-3.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-xl text-base font-semibold shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 transition-all duration-200"
            >
              {t('Начать бесплатно', 'Start for Free')}
              <ArrowRight size={18} />
            </Link>
            <button
              onClick={scrollToFeatures}
              className="inline-flex items-center gap-2 px-8 py-3.5 border border-gray-300 dark:border-gray-700 rounded-xl text-base font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              {t('Узнать больше', 'Learn More')}
              <ChevronDown size={18} />
            </button>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce opacity-40">
          <ChevronDown size={24} />
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────── */}
      <section id="features" className="py-24 px-4 bg-gray-50/50 dark:bg-gray-900/50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-3">
              {t('Возможности', 'Features')}
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold">
              {t('Всё для продуктивности в одном месте', 'All-in-one productivity workspace')}
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features(t).map((f) => (
              <div
                key={f.title}
                className="group relative bg-white dark:bg-gray-800/60 rounded-2xl p-6 border border-gray-200/80 dark:border-gray-700/50 hover:border-indigo-300 dark:hover:border-indigo-600/50 hover:shadow-lg hover:shadow-indigo-500/5 transition-all duration-200"
              >
                <div className="w-11 h-11 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center mb-4 group-hover:bg-indigo-100 dark:group-hover:bg-indigo-900/50 transition-colors">
                  <f.icon size={22} className="text-indigo-600 dark:text-indigo-400" strokeWidth={1.8} />
                </div>
                <h3 className="text-base font-semibold mb-1.5">{f.title}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ────────────────────────────────────── */}
      <section className="py-24 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-3">
              {t('Как это работает', 'How It Works')}
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold">
              {t('Три простых шага', 'Three Simple Steps')}
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {steps(t).map((s, i) => (
              <div key={s.num} className="relative text-center">
                {/* Connector line */}
                {i < 2 && (
                  <div className="hidden md:block absolute top-10 left-[60%] w-[80%] border-t-2 border-dashed border-indigo-200 dark:border-indigo-800" />
                )}
                <div className="relative z-10 mx-auto w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 mb-5">
                  <s.icon size={32} className="text-white" strokeWidth={1.6} />
                </div>
                <div className="text-xs font-bold text-indigo-500 dark:text-indigo-400 mb-1">{s.num}</div>
                <h3 className="text-lg font-semibold mb-2">{s.title}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────────── */}
      <section className="py-24 px-4 bg-gray-50/50 dark:bg-gray-900/50">
        <div className="max-w-lg mx-auto text-center">
          <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-3">
            {t('Тарифы', 'Pricing')}
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold mb-10">
            {t('Просто и прозрачно', 'Simple and Transparent')}
          </h2>

          <div className="bg-white dark:bg-gray-800/60 rounded-2xl p-8 border border-gray-200/80 dark:border-gray-700/50 shadow-lg shadow-indigo-500/5">
            <div className="inline-flex items-center gap-2 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-full px-4 py-1.5 text-sm font-medium mb-5">
              <Zap size={16} />
              {t('Бесплатно', 'Free')}
            </div>
            <div className="text-4xl font-extrabold mb-2">
              0 <span className="text-lg font-normal text-gray-400">/ {t('мес', 'mo')}</span>
            </div>
            <p className="text-gray-500 dark:text-gray-400 mb-6">
              {t(
                'Все функции доступны, без ограничений',
                'All features available, no limits',
              )}
            </p>
            <Link
              to="/login"
              className="inline-flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-xl text-sm font-semibold shadow-md shadow-indigo-500/20 transition-all duration-200"
            >
              {t('Начать бесплатно', 'Start for Free')}
              <ArrowRight size={16} />
            </Link>
            <p className="mt-6 text-xs text-gray-400">
              {t('Pro и Enterprise — скоро', 'Pro and Enterprise — coming soon')}
            </p>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer className="border-t border-gray-200 dark:border-gray-800 py-8 px-4">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-400 dark:text-gray-500">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <span className="text-white font-bold text-[9px]">CS</span>
            </div>
            <span>&copy; 2026 Clarity Space</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/terms" className="hover:text-indigo-500 transition-colors">
              {t('Условия', 'Terms')}
            </Link>
            <Link to="/privacy" className="hover:text-indigo-500 transition-colors">
              {t('Политика конфиденциальности', 'Privacy Policy')}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
