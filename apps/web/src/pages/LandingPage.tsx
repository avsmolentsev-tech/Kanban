import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useLangStore } from '../store/lang.store';
import {
  Mic, Columns3, Bot, Flame, CalendarDays, Link2,
  Users, Lightbulb, BarChart3, ArrowRight,
  Sparkles, CheckCircle2, Zap, Target, FileText,
  Brain, GanttChart, Smartphone, PenLine, BookOpen,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/* ── Scroll reveal ── */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const els = root.querySelectorAll<HTMLElement>('.reveal');
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { (e.target as HTMLElement).style.animationPlayState = 'running'; io.unobserve(e.target); } }),
      { threshold: 0.12 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return ref;
}

/* ── Feature card ── */
function Card({ icon: Icon, title, desc, delay }: { icon: LucideIcon; title: string; desc: string; delay: number }) {
  return (
    <div className="reveal group relative bg-white/70 dark:bg-white/[0.04] backdrop-blur-md rounded-2xl p-6 border border-gray-200/60 dark:border-white/[0.06] hover:border-indigo-300/60 dark:hover:border-indigo-500/30 hover:shadow-xl hover:shadow-indigo-500/[0.04] transition-all duration-300 cursor-pointer" style={{ animationDelay: `${delay}ms` }}>
      <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500/10 to-purple-500/10 dark:from-indigo-500/20 dark:to-purple-500/20 flex items-center justify-center mb-4 group-hover:from-indigo-500/20 group-hover:to-purple-500/20 transition-colors duration-300">
        <Icon size={22} className="text-indigo-600 dark:text-indigo-400" strokeWidth={1.8} />
      </div>
      <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white mb-1.5">{title}</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{desc}</p>
    </div>
  );
}

/* ── Widget mockup (iPhone) ── */
function WidgetMockup({ t }: { t: (ru: string, en: string) => string }) {
  return (
    <div className="w-[170px] h-[170px] rounded-[22px] bg-gradient-to-br from-[#1e1b4b] to-[#312e81] p-4 shadow-2xl shadow-indigo-900/40 border border-indigo-400/10 flex flex-col justify-between text-white select-none">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-md bg-indigo-500 flex items-center justify-center"><span className="text-[7px] font-bold">CS</span></div>
          <span className="text-[10px] font-semibold opacity-90">Clarity Space</span>
        </div>
        <span className="text-[9px] opacity-50">21.05</span>
      </div>
      <div className="space-y-1.5 mt-2">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-amber-400/80 flex items-center justify-center"><span className="text-[6px]">!</span></div>
          <span className="text-[10px] opacity-80">{t('3 задачи на сегодня', '3 tasks today')}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <CalendarDays size={12} className="opacity-60" />
          <span className="text-[10px] opacity-70 truncate">{t('Встреча с командой', 'Team meeting')}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Flame size={12} className="text-orange-400 opacity-80" />
          <span className="text-[10px] opacity-70">{t('2/5 привычек', '2/5 habits')}</span>
        </div>
      </div>
    </div>
  );
}

/* ================================================================ */
export function LandingPage() {
  const { t } = useLangStore();
  const wrapRef = useReveal();

  return (
    <div ref={wrapRef} className="min-h-screen bg-[#fafbff] dark:bg-[#0a0c1a] text-gray-900 dark:text-gray-100 overflow-x-hidden selection:bg-indigo-500/20">
      {/* ── Inline anim styles ── */}
      <style>{`
        .reveal { opacity:0; transform:translateY(20px); animation:fadeUp .65s ease forwards; animation-play-state:paused; }
        @keyframes fadeUp { to { opacity:1; transform:translateY(0); } }
        @keyframes float { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-12px); } }
      `}</style>

      {/* ── Header ── */}
      <header className="sticky top-0 z-50 bg-[#fafbff]/80 dark:bg-[#0a0c1a]/80 backdrop-blur-xl border-b border-gray-200/40 dark:border-white/[0.04]">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <span className="text-white font-bold text-xs">CS</span>
            </div>
            <span className="font-bold text-base tracking-tight">Clarity Space</span>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })} className="hidden sm:block text-sm text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer">
              {t('Возможности', 'Features')}
            </button>
            <Link to="/login" className="px-5 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer">
              {t('Войти', 'Sign In')}
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative min-h-[92vh] flex items-center justify-center px-5 overflow-hidden">
        {/* Gradient mesh */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute top-[-20%] right-[-10%] w-[700px] h-[700px] rounded-full bg-indigo-400/[0.12] dark:bg-indigo-500/[0.06] blur-[100px]" />
          <div className="absolute top-[10%] left-[-15%] w-[500px] h-[500px] rounded-full bg-purple-400/[0.10] dark:bg-purple-500/[0.05] blur-[80px]" />
          <div className="absolute bottom-[-10%] right-[20%] w-[600px] h-[600px] rounded-full bg-violet-300/[0.08] dark:bg-violet-500/[0.04] blur-[120px]" />
        </div>

        <div className="relative z-10 max-w-5xl mx-auto flex flex-col lg:flex-row items-center gap-16">
          {/* Left: copy */}
          <div className="flex-1 text-center lg:text-left">
            <div className="reveal inline-flex items-center gap-2 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-full px-4 py-1.5 text-sm font-medium mb-6">
              <Sparkles size={15} />
              {t('AI-ассистент для предпринимателей', 'AI Assistant for Entrepreneurs')}
            </div>

            <h1 className="reveal text-[40px] sm:text-[56px] lg:text-[64px] font-extrabold tracking-tight leading-[1.08]" style={{ animationDelay: '80ms' }}>
              {t('Ни одна идея', 'No idea')}<br />
              <span className="bg-gradient-to-r from-indigo-600 to-purple-600 dark:from-indigo-400 dark:to-purple-400 bg-clip-text text-transparent">
                {t('не потеряется', 'gets lost')}
              </span>
            </h1>

            <p className="reveal mt-6 text-base sm:text-lg text-gray-500 dark:text-gray-400 leading-relaxed max-w-xl" style={{ animationDelay: '160ms' }}>
              {t(
                'Записывай встречи и лекции, ставь задачи голосом, отслеживай привычки и цели. AI создаёт резюме и план на день. Всё связано через Obsidian — люди, проекты, идеи.',
                'Record meetings and lectures, set tasks by voice, track habits and goals. AI creates summaries and daily plans. Everything connected via Obsidian — people, projects, ideas.',
              )}
            </p>

            <div className="reveal mt-8 flex flex-col sm:flex-row items-center lg:items-start gap-3" style={{ animationDelay: '240ms' }}>
              <Link to="/login" className="inline-flex items-center gap-2 px-7 py-3.5 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-xl text-[15px] font-semibold hover:opacity-90 transition-opacity cursor-pointer shadow-lg shadow-gray-900/10 dark:shadow-white/10">
                {t('Начать бесплатно', 'Start for Free')}
                <ArrowRight size={17} />
              </Link>
              <button onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })} className="inline-flex items-center gap-2 px-7 py-3.5 border border-gray-300 dark:border-gray-700 rounded-xl text-[15px] font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.04] transition-colors cursor-pointer">
                {t('Как это работает', 'How It Works')}
              </button>
            </div>
          </div>

          {/* Right: widget mockup */}
          <div className="reveal flex-shrink-0" style={{ animationDelay: '300ms', animation: 'float 6s ease-in-out infinite, fadeUp .65s ease forwards', animationPlayState: 'paused' }}>
            <WidgetMockup t={t} />
          </div>
        </div>
      </section>

      {/* ── Value props ── */}
      <section className="py-20 px-5 border-t border-gray-200/50 dark:border-white/[0.04]">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-10 text-center">
          {[
            { icon: Mic, t1: t('Записал — готово', 'Record — Done'), t2: t('Встречи, лекции, идеи — надиктуй, AI сделает задачи и резюме', 'Meetings, lectures, ideas — dictate, AI creates tasks and summary') },
            { icon: Link2, t1: t('Всё связано', 'Everything Connected'), t2: t('Люди, проекты, идеи, встречи — Obsidian граф связей', 'People, projects, ideas, meetings — Obsidian knowledge graph') },
            { icon: Smartphone, t1: t('Работает везде', 'Works Everywhere'), t2: t('Telegram-бот, iPhone виджет, веб — всегда под рукой', 'Telegram bot, iPhone widget, web — always at hand') },
          ].map((v, i) => (
            <div key={v.t1} className="reveal" style={{ animationDelay: `${i * 100}ms` }}>
              <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/15 mb-5">
                <v.icon size={26} className="text-white" strokeWidth={1.6} />
              </div>
              <h3 className="text-lg font-bold mb-2">{v.t1}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed max-w-xs mx-auto">{v.t2}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="py-24 px-5 bg-gray-50/60 dark:bg-white/[0.015]">
        <div className="max-w-6xl mx-auto">
          <div className="reveal text-center mb-14">
            <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-2">{t('Возможности', 'Features')}</p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">{t('Всё для продуктивности', 'All-in-one Productivity')}</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {([
              { icon: Mic, t: t('Транскрибация встреч', 'Meeting Transcription'), d: t('Аудио → резюме, задачи, Q&A. Встречи и лекции.', 'Audio → summary, tasks, Q&A. Meetings and lectures.') },
              { icon: Bot, t: t('AI-ассистент в Telegram', 'AI Telegram Assistant'), d: t('Голосовые команды, брифинг, мотивация каждый день.', 'Voice commands, briefing, daily motivation.') },
              { icon: Columns3, t: t('Kanban-доска', 'Kanban Board'), d: t('Drag & drop, приоритеты, подзадачи, исполнители.', 'Drag & drop, priorities, subtasks, assignees.') },
              { icon: GanttChart, t: t('Диаграмма Ганта', 'Gantt Chart'), d: t('Проекты на временной шкале. Сроки и зависимости.', 'Projects on timeline. Deadlines and dependencies.') },
              { icon: CalendarDays, t: t('Умный календарь', 'Smart Calendar'), d: t('День, 3 дня, неделя, месяц. Google Calendar.', 'Day, 3-day, week, month. Google Calendar.') },
              { icon: Target, t: t('Цели и BHAG', 'Goals & BHAG'), d: t('AI-декомпозиция больших целей. Mind map.', 'AI decomposition of big goals. Mind map.') },
              { icon: Flame, t: t('Привычки', 'Habits'), d: t('Стрики, статистика, напоминания.', 'Streaks, statistics, reminders.') },
              { icon: FileText, t: t('Документы', 'Documents'), d: t('Notion-стиль. Вложенные страницы, проекты.', 'Notion-style. Nested pages, projects.') },
              { icon: Users, t: t('CRM контактов', 'Contact CRM'), d: t('Люди, компании, история встреч.', 'People, companies, meeting history.') },
              { icon: Lightbulb, t: t('Банк идей', 'Idea Bank'), d: t('Сохраняй идеи, привязывай к проектам.', 'Save ideas, link to projects.') },
              { icon: Link2, t: t('Obsidian', 'Obsidian'), d: t('Wiki-ссылки, граф связей, vault.', 'Wiki-links, knowledge graph, vault.') },
              { icon: BarChart3, t: t('Дашборд', 'Dashboard'), d: t('План дня, аналитика, прогресс проектов.', 'Daily plan, analytics, project progress.') },
              { icon: Brain, t: t('AI-коуч', 'AI Coach'), d: t('Мотивация, план на день, настроение.', 'Motivation, daily plan, mood.') },
              { icon: PenLine, t: t('Дневник', 'Journal'), d: t('Фокус дня, настроение, заметки.', 'Daily focus, mood, notes.') },
              { icon: BookOpen, t: t('Статистика', 'Statistics'), d: t('Продуктивность, активности, привычки.', 'Productivity, activities, habits.') },
            ]).map((f, i) => (
              <Card key={f.t} icon={f.icon} title={f.t} desc={f.d} delay={(i % 3) * 80} />
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how" className="py-24 px-5">
        <div className="max-w-4xl mx-auto">
          <div className="reveal text-center mb-14">
            <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-2">{t('Как это работает', 'How It Works')}</p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">{t('Записал — и забыл', 'Record — and Forget')}</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { n: '01', icon: Mic, t: t('Запиши', 'Record'), d: t('Встречу, лекцию, идею', 'Meeting, lecture, idea') },
              { n: '02', icon: Bot, t: t('Отправь боту', 'Send to Bot'), d: t('Голосом или файлом в TG', 'Voice or file in TG') },
              { n: '03', icon: Sparkles, t: t('AI обработает', 'AI Processes'), d: t('Задачи, резюме, проект', 'Tasks, summary, project') },
              { n: '04', icon: CheckCircle2, t: t('Работай', 'Work'), d: t('Kanban, календарь, TG', 'Kanban, calendar, TG') },
            ].map((s, i) => (
              <div key={s.n} className="reveal text-center" style={{ animationDelay: `${i * 100}ms` }}>
                <div className="relative z-10 mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/15 mb-4">
                  <s.icon size={28} className="text-white" strokeWidth={1.6} />
                </div>
                <div className="text-[11px] font-bold text-indigo-500 dark:text-indigo-400 mb-0.5">{s.n}</div>
                <h3 className="text-base font-semibold mb-1">{s.t}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section className="py-24 px-5 bg-gray-50/60 dark:bg-white/[0.015]">
        <div className="max-w-md mx-auto text-center">
          <h2 className="reveal text-3xl sm:text-4xl font-bold tracking-tight mb-10">{t('Бесплатно', 'Free')}</h2>
          <div className="reveal bg-white/80 dark:bg-white/[0.04] backdrop-blur-md rounded-2xl p-8 border border-gray-200/60 dark:border-white/[0.06] shadow-xl shadow-gray-200/20 dark:shadow-none" style={{ animationDelay: '80ms' }}>
            <div className="inline-flex items-center gap-1.5 bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400 rounded-full px-3.5 py-1 text-sm font-medium mb-4">
              <Zap size={15} />
              {t('Все функции', 'All Features')}
            </div>
            <div className="text-5xl font-extrabold mb-1">0 <span className="text-base font-normal text-gray-400">/ {t('мес', 'mo')}</span></div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{t('AI, транскрибация, бот, Obsidian — без ограничений.', 'AI, transcription, bot, Obsidian — no limits.')}</p>
            <Link to="/login" className="inline-flex items-center gap-2 px-7 py-3 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity cursor-pointer">
              {t('Начать', 'Get Started')}
              <ArrowRight size={15} />
            </Link>
            <p className="mt-5 text-xs text-gray-400">{t('Pro и Enterprise — скоро', 'Pro & Enterprise — coming soon')}</p>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-gray-200/50 dark:border-white/[0.04] py-8 px-5">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-400 dark:text-gray-500">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <span className="text-white font-bold text-[7px]">CS</span>
            </div>
            <span>&copy; 2026 Clarity Space</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/terms" className="hover:text-indigo-500 transition-colors cursor-pointer">{t('Условия', 'Terms')}</Link>
            <Link to="/privacy" className="hover:text-indigo-500 transition-colors cursor-pointer">{t('Конфиденциальность', 'Privacy')}</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
