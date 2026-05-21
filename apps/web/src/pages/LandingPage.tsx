import { Link } from 'react-router-dom';
import { useLangStore } from '../store/lang.store';
import {
  Mic, Columns3, Bot, Flame, CalendarDays, Link2,
  Users, Lightbulb, BarChart3, ArrowRight, ChevronDown,
  Sparkles, CheckCircle2, Zap, Target, FileText,
  BookOpen, Smartphone, Brain, PenLine, GanttChart,
} from 'lucide-react';

export function LandingPage() {
  const { t } = useLangStore();

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 overflow-x-hidden">

      {/* ── Sticky Header ── */}
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-gray-950/80 backdrop-blur-xl border-b border-gray-200/50 dark:border-gray-800/50">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
              <span className="text-white font-bold text-sm">CS</span>
            </div>
            <span className="font-bold text-lg">Clarity Space</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => scrollTo('features')} className="hidden sm:block text-sm text-gray-500 hover:text-indigo-600 transition-colors">
              {t('Возможности', 'Features')}
            </button>
            <Link to="/login" className="px-5 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg text-sm font-medium shadow-md shadow-indigo-500/20 hover:shadow-indigo-500/40 transition-all">
              {t('Войти', 'Sign In')}
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative min-h-[90vh] flex items-center justify-center px-4 overflow-hidden">
        <div className="pointer-events-none absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full bg-indigo-400/20 dark:bg-indigo-400/[0.08] blur-[40px]" style={{ animation: 'circleLeft 30s cubic-bezier(0.45,0,0.55,1) infinite' }} />
        <div className="pointer-events-none absolute -top-20 left-1/4 w-[400px] h-[400px] rounded-full bg-purple-400/15 dark:bg-purple-400/[0.06] blur-[60px]" style={{ animation: 'circleLeftSlow 26s cubic-bezier(0.45,0,0.55,1) infinite' }} />
        <div className="pointer-events-none absolute bottom-20 -left-40 w-[550px] h-[550px] rounded-full bg-indigo-400/[0.14] dark:bg-violet-400/[0.07] blur-[80px]" style={{ animation: 'circleRight 34s cubic-bezier(0.45,0,0.55,1) infinite' }} />

        <div className="relative z-10 text-center max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-full px-4 py-1.5 text-sm font-medium mb-8">
            <Sparkles size={16} />
            {t('AI-ассистент для предпринимателей', 'AI Assistant for Entrepreneurs')}
          </div>

          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.1]">
            {t('Ни одна идея', 'No idea')}
            <br />
            <span className="bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 dark:from-indigo-400 dark:via-purple-400 dark:to-indigo-400 bg-clip-text text-transparent">
              {t('не потеряется', 'gets lost')}
            </span>
          </h1>

          <p className="mt-6 text-lg sm:text-xl text-gray-500 dark:text-gray-400 max-w-2xl mx-auto leading-relaxed">
            {t(
              'Записывай встречи, ставь задачи голосом, отслеживай привычки. AI создаёт резюме, план на день и следит за прогрессом. Всё связано: люди, проекты, идеи.',
              'Record meetings, set tasks by voice, track habits. AI creates summaries, daily plans and tracks progress. Everything connected: people, projects, ideas.',
            )}
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to="/login" className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-xl text-base font-semibold shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 transition-all">
              {t('Начать бесплатно', 'Start for Free')}
              <ArrowRight size={18} />
            </Link>
            <button onClick={() => scrollTo('features')} className="inline-flex items-center gap-2 px-8 py-4 border border-gray-300 dark:border-gray-700 rounded-xl text-base font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              {t('Узнать больше', 'Learn More')}
              <ChevronDown size={18} />
            </button>
          </div>
        </div>

        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce opacity-40">
          <ChevronDown size={24} />
        </div>
      </section>

      {/* ── Core Value Props ── */}
      <section className="py-20 px-4 border-t border-gray-100 dark:border-gray-800/50">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-10 text-center">
          {[
            { icon: Mic, title: t('Записал — готово', 'Record — Done'), desc: t('Встречи, лекции, идеи — надиктовал, AI сделал задачи и резюме', 'Meetings, lectures, ideas — dictate, AI makes tasks and summary') },
            { icon: Link2, title: t('Всё связано', 'Everything Connected'), desc: t('Люди, проекты, идеи, встречи — Obsidian граф связей и взаимосвязей', 'People, projects, ideas, meetings — Obsidian graph of connections') },
            { icon: Smartphone, title: t('Работает везде', 'Works Everywhere'), desc: t('Telegram-бот, iPhone виджет, веб-приложение — всегда под рукой', 'Telegram bot, iPhone widget, web app — always at hand') },
          ].map(v => (
            <div key={v.title}>
              <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 mb-5">
                <v.icon size={28} className="text-white" strokeWidth={1.6} />
              </div>
              <h3 className="text-xl font-bold mb-2">{v.title}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{v.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features Grid ── */}
      <section id="features" className="py-24 px-4 bg-gray-50/50 dark:bg-gray-900/50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-3">
              {t('Возможности', 'Features')}
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold">
              {t('Всё для продуктивности', 'All-in-one Productivity')}
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {([
              { icon: Mic, title: t('Транскрибация встреч', 'Meeting Transcription'), desc: t('Отправь аудио — получи резюме, задачи, Q&A. Встречи и лекции.', 'Send audio — get summary, tasks, Q&A. Meetings and lectures.') },
              { icon: Bot, title: t('AI-ассистент в Telegram', 'AI Telegram Assistant'), desc: t('Голосовые команды, создание задач, брифинг. Подбадривает и мотивирует.', 'Voice commands, task creation, briefing. Encourages and motivates.') },
              { icon: Columns3, title: t('Kanban-доска', 'Kanban Board'), desc: t('Задачи по статусам, drag & drop, приоритеты, подзадачи, исполнители.', 'Tasks by status, drag & drop, priorities, subtasks, assignees.') },
              { icon: GanttChart, title: t('Диаграмма Ганта', 'Gantt Chart'), desc: t('Все проекты на временной шкале. Видно сроки, зависимости, прогресс.', 'All projects on timeline. See deadlines, dependencies, progress.') },
              { icon: CalendarDays, title: t('Умный календарь', 'Smart Calendar'), desc: t('День, 3 дня, неделя, месяц. Google Calendar синхронизация.', 'Day, 3-day, week, month. Google Calendar sync.') },
              { icon: Target, title: t('Цели и BHAG', 'Goals & BHAG'), desc: t('Большие цели с AI-декомпозицией на milestones и задачи. Mind map.', 'Big goals with AI decomposition into milestones and tasks. Mind map.') },
              { icon: Flame, title: t('Трекер привычек', 'Habit Tracker'), desc: t('Ежедневные привычки, стрики, статистика за месяц. Напоминания.', 'Daily habits, streaks, monthly stats. Reminders.') },
              { icon: FileText, title: t('Документы как в Notion', 'Notion-like Docs'), desc: t('Документы с вложенными страницами, привязка к проектам и людям.', 'Documents with nested pages, linked to projects and people.') },
              { icon: Users, title: t('CRM контактов', 'Contact CRM'), desc: t('Люди, компании, история встреч, договорённости. Всё в одном месте.', 'People, companies, meeting history, agreements. All in one place.') },
              { icon: Lightbulb, title: t('Банк идей', 'Idea Bank'), desc: t('Любая идея сохранена и привязана к проекту. Ничего не теряется.', 'Every idea saved and linked to a project. Nothing gets lost.') },
              { icon: Link2, title: t('Obsidian синхронизация', 'Obsidian Sync'), desc: t('Все данные в vault: встречи, задачи, люди. Wiki-ссылки, граф.', 'All data in vault: meetings, tasks, people. Wiki-links, graph.') },
              { icon: BarChart3, title: t('Дашборд и аналитика', 'Dashboard & Analytics'), desc: t('План на день, анализ продуктивности, прогресс проектов, дневник.', 'Daily plan, productivity analysis, project progress, journal.') },
              { icon: Brain, title: t('AI-коуч', 'AI Coach'), desc: t('Генерация плана на день, мотивация, отслеживание настроения.', 'Daily plan generation, motivation, mood tracking.') },
              { icon: PenLine, title: t('Дневник', 'Journal'), desc: t('Ведите дневник, отслеживайте настроение, фокус дня.', 'Keep a journal, track mood, daily focus.') },
              { icon: BookOpen, title: t('Статистика', 'Statistics'), desc: t('Личная продуктивность, активности по проектам, привычки.', 'Personal productivity, project activities, habits.') },
            ]).map(f => (
              <div key={f.title} className="group bg-white dark:bg-gray-800/60 rounded-2xl p-6 border border-gray-200/80 dark:border-gray-700/50 hover:border-indigo-300 dark:hover:border-indigo-600/50 hover:shadow-lg hover:shadow-indigo-500/5 transition-all">
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

      {/* ── How It Works ── */}
      <section className="py-24 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-3">
              {t('Как это работает', 'How It Works')}
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold">
              {t('Записал — и забыл', 'Record — and Forget')}
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[
              { num: '01', icon: Mic, title: t('Запиши', 'Record'), desc: t('Встречу, лекцию или идею', 'Meeting, lecture or idea') },
              { num: '02', icon: Bot, title: t('Отправь боту', 'Send to Bot'), desc: t('В Telegram голосом или файлом', 'Via Telegram voice or file') },
              { num: '03', icon: Sparkles, title: t('AI обработает', 'AI Processes'), desc: t('Задачи, резюме, люди, проект', 'Tasks, summary, people, project') },
              { num: '04', icon: CheckCircle2, title: t('Проверь и работай', 'Review & Work'), desc: t('Kanban, календарь, Telegram', 'Kanban, calendar, Telegram') },
            ].map((s, i) => (
              <div key={s.num} className="relative text-center">
                {i < 3 && <div className="hidden md:block absolute top-10 left-[60%] w-[80%] border-t-2 border-dashed border-indigo-200 dark:border-indigo-800" />}
                <div className="relative z-10 mx-auto w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 mb-5">
                  <s.icon size={32} className="text-white" strokeWidth={1.6} />
                </div>
                <div className="text-xs font-bold text-indigo-500 dark:text-indigo-400 mb-1">{s.num}</div>
                <h3 className="text-lg font-semibold mb-1">{s.title}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section className="py-24 px-4 bg-gray-50/50 dark:bg-gray-900/50">
        <div className="max-w-lg mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-10">
            {t('Бесплатно для всех', 'Free for Everyone')}
          </h2>
          <div className="bg-white dark:bg-gray-800/60 rounded-2xl p-8 border border-gray-200/80 dark:border-gray-700/50 shadow-lg">
            <div className="inline-flex items-center gap-2 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-full px-4 py-1.5 text-sm font-medium mb-5">
              <Zap size={16} />
              {t('Все функции', 'All Features')}
            </div>
            <div className="text-5xl font-extrabold mb-2">
              0 <span className="text-lg font-normal text-gray-400">/ {t('мес', 'mo')}</span>
            </div>
            <p className="text-gray-500 dark:text-gray-400 mb-6">
              {t('Без ограничений. AI, транскрибация, Telegram-бот, Obsidian — всё включено.', 'No limits. AI, transcription, Telegram bot, Obsidian — all included.')}
            </p>
            <Link to="/login" className="inline-flex items-center gap-2 px-8 py-3.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-xl text-sm font-semibold shadow-md transition-all">
              {t('Начать', 'Get Started')}
              <ArrowRight size={16} />
            </Link>
            <p className="mt-6 text-xs text-gray-400">{t('Pro и Enterprise — скоро', 'Pro & Enterprise — coming soon')}</p>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-gray-200 dark:border-gray-800 py-8 px-4">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-400 dark:text-gray-500">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <span className="text-white font-bold text-[9px]">CS</span>
            </div>
            <span>&copy; 2026 Clarity Space</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/terms" className="hover:text-indigo-500 transition-colors">{t('Условия', 'Terms')}</Link>
            <Link to="/privacy" className="hover:text-indigo-500 transition-colors">{t('Конфиденциальность', 'Privacy')}</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
