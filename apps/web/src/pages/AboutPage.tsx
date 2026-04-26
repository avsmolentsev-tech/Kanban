import { useEffect, useRef } from 'react';
import {
  Mic, FileText, Target, LayoutGrid, Brain, Bot,
  BookOpen, Smartphone, BarChart3, ArrowRight,
  Send, Sparkles, CheckCircle2, Zap, Infinity, Rocket
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Fade-in-on-scroll observer (pure CSS animation triggered by JS)   */
/* ------------------------------------------------------------------ */
function useScrollReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const els = root.querySelectorAll<HTMLElement>('.reveal');
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { (e.target as HTMLElement).style.animationPlayState = 'running'; io.unobserve(e.target); } }),
      { threshold: 0.15 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return ref;
}

/* ------------------------------------------------------------------ */
/*  Reusable bits                                                     */
/* ------------------------------------------------------------------ */
function FeatureCard({ icon: Icon, title, text, delay }: { icon: LucideIcon; title: string; text: string; delay: number }) {
  return (
    <div
      className="reveal rounded-2xl border border-white/[0.06] bg-white/[0.03] p-6 hover:bg-white/[0.06] transition-colors"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20">
        <Icon size={22} className="text-indigo-400" />
      </div>
      <h3 className="mb-2 text-lg font-semibold text-white">{title}</h3>
      <p className="text-sm leading-relaxed text-slate-400">{text}</p>
    </div>
  );
}

function StepCard({ icon: Icon, label, idx }: { icon: LucideIcon; label: string; idx: number }) {
  return (
    <div className="reveal flex flex-col items-center gap-3 text-center" style={{ animationDelay: `${idx * 120}ms` }}>
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/20">
        <Icon size={24} className="text-white" />
      </div>
      <span className="text-sm font-medium text-slate-300">{label}</span>
    </div>
  );
}

function StatBlock({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="reveal flex flex-col items-center gap-2 text-center" style={{ animationDelay: '0ms' }}>
      <Icon size={28} className="text-indigo-400" />
      <span className="text-sm font-semibold text-white">{label}</span>
    </div>
  );
}

/* ================================================================== */
/*  PAGE                                                              */
/* ================================================================== */
export function AboutPage() {
  const wrapRef = useScrollReveal();

  return (
    <div ref={wrapRef} className="min-h-screen bg-[#0f172a] text-white selection:bg-indigo-500/40">
      {/* ---------- inline animation styles ---------- */}
      <style>{`
        .reveal {
          opacity: 0;
          transform: translateY(24px);
          animation: fadeInUp .7s ease forwards;
          animation-play-state: paused;
        }
        @keyframes fadeInUp {
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* ========== HEADER ========== */}
      <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#0f172a]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/25">
              <span className="text-sm font-bold text-white">CS</span>
            </div>
            <div>
              <div className="text-base font-bold leading-tight">Clarity Space</div>
              <div className="text-[11px] text-slate-500">Personal Intelligence System</div>
            </div>
          </div>
          <a
            href="/login"
            className="rounded-lg bg-white/10 px-5 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/20"
          >
            Войти
          </a>
        </div>
      </header>

      {/* ========== HERO ========== */}
      <section className="relative overflow-hidden">
        {/* decorative blobs */}
        <div className="pointer-events-none absolute -top-40 left-1/2 h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-indigo-600/20 blur-[160px]" />
        <div className="pointer-events-none absolute -top-20 left-1/4 h-[400px] w-[400px] rounded-full bg-purple-600/10 blur-[120px]" />

        <div className="relative mx-auto max-w-4xl px-6 pb-20 pt-28 text-center">
          <h1 className="reveal mb-6 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl md:text-6xl">
            Управляй бизнесом{' '}
            <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">голосом</span>
          </h1>
          <p className="reveal mx-auto mb-10 max-w-2xl text-lg text-slate-400 sm:text-xl" style={{ animationDelay: '100ms' }}>
            AI-ассистент для предпринимателя: записал встречу &mdash; получил задачи, цели, mind&nbsp;map. Все автоматически.
          </p>
          <a
            href="/login"
            className="reveal inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:shadow-indigo-500/40 hover:brightness-110"
            style={{ animationDelay: '200ms' }}
          >
            Попробовать
            <ArrowRight size={18} />
          </a>
        </div>
      </section>

      {/* ========== FEATURES GRID ========== */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="reveal mb-12 text-center text-3xl font-bold">Все инструменты в одном месте</h2>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard icon={Mic}        title="Транскрибация встреч"  delay={0}   text="Отправь аудио в Telegram — бот расшифрует, определит участников, проект, компанию. Подтверди или поправь голосом." />
          <FeatureCard icon={FileText}   title="Умные карточки"       delay={80}  text="AI предлагает карточку: тип, название, проект, теги. Inline-кнопки для подтверждения. Все сохраняется в Obsidian." />
          <FeatureCard icon={Target}     title="BHAG Mind Map"        delay={160} text="Поставь большую цель — AI разложит на milestones и задачи. Интерактивная карта с прогресс-трекингом." />
          <FeatureCard icon={LayoutGrid} title="Kanban + Timeline"    delay={0}   text="Классическая доска задач. Timeline по дням. Календарь с Google Calendar синхронизацией." />
          <FeatureCard icon={Brain}      title="AI Coach"             delay={80}  text="Еженедельные цели, фокус дня, пятничный отчет по BHAG. Бот напоминает и мотивирует." />
          <FeatureCard icon={Bot}        title="DevOps Bot"           delay={160} text="Отдельный бот для разработки. Пишешь задачу — Claude Code правит код, коммитит, деплоит." />
          <FeatureCard icon={BookOpen}   title="Obsidian"             delay={0}   text="Двусторонняя синхронизация. YAML frontmatter, wiki-ссылки, Graph View. Daily backup на Google Drive." />
          <FeatureCard icon={Smartphone} title="Telegram-бот"         delay={80}  text="Полноценный AI-ассистент. Понимает контекст, помнит последние действия. Голос и текст." />
          <FeatureCard icon={BarChart3}  title="И еще"               delay={160} text="OKR, дневник, привычки, CRM, проекты, iPhone виджет, темная тема, мультиюзер." />
        </div>
      </section>

      {/* ========== HOW IT WORKS ========== */}
      <section className="border-y border-white/[0.06] bg-white/[0.02]">
        <div className="mx-auto max-w-4xl px-6 py-20">
          <h2 className="reveal mb-14 text-center text-3xl font-bold">Как это работает</h2>

          <div className="flex flex-wrap items-start justify-center gap-6 sm:gap-10">
            <StepCard icon={Mic}       label="Записал встречу"      idx={0} />
            <ArrowRight size={20} className="mt-5 hidden text-slate-600 sm:block" />
            <StepCard icon={Send}      label="Отправил в Telegram"  idx={1} />
            <ArrowRight size={20} className="mt-5 hidden text-slate-600 sm:block" />
            <StepCard icon={Sparkles}  label="AI разобрал"          idx={2} />
            <ArrowRight size={20} className="mt-5 hidden text-slate-600 sm:block" />
            <StepCard icon={CheckCircle2} label="Задачи на доске"   idx={3} />
          </div>
        </div>
      </section>

      {/* ========== STATS ========== */}
      <section className="mx-auto max-w-4xl px-6 py-20">
        <div className="reveal grid grid-cols-2 gap-8 sm:grid-cols-4">
          <StatBlock icon={Infinity} label="Безлимит аудио" />
          <StatBlock icon={Target}   label="4 шаблона BHAG" />
          <StatBlock icon={Zap}      label="Локальный whisper" />
          <StatBlock icon={Rocket}   label="Автодеплой" />
        </div>
      </section>

      {/* ========== FOOTER ========== */}
      <footer className="border-t border-white/[0.06] bg-[#0b1120]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
          <span className="text-sm text-slate-500">Clarity Space &copy; 2026</span>
          <div className="flex gap-6 text-sm text-slate-500">
            <a href="https://t.me/ClaritySpaceBot" target="_blank" rel="noopener noreferrer" className="transition hover:text-indigo-400">Telegram Bot</a>
            <a href="https://github.com/pis-dev" target="_blank" rel="noopener noreferrer" className="transition hover:text-indigo-400">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
