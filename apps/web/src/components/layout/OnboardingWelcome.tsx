import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLangStore } from '../../store/lang.store';
import {
  Columns3, Users, MessageCircle, Zap, X, Mic, Target, Flame,
  CalendarDays, FileText, BarChart3, Link2, Lightbulb, ArrowRight,
  Smartphone, Brain, GanttChart,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const STORAGE_KEY = 'clarity-onboarding-seen';

// Global event to trigger onboarding from anywhere
const ONBOARDING_EVENT = 'show-onboarding';

interface Step {
  icon: LucideIcon;
  color: string;
  bg: string;
  title: string;
  desc: string;
  tip?: string;
  action?: { label: string; route: string };
}

export function OnboardingWelcome() {
  const { t } = useLangStore();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(() => !localStorage.getItem(STORAGE_KEY));
  const [step, setStep] = useState(0);

  const show = useCallback(() => {
    setStep(0);
    setVisible(true);
  }, []);

  useEffect(() => {
    window.addEventListener(ONBOARDING_EVENT, show);
    return () => window.removeEventListener(ONBOARDING_EVENT, show);
  }, [show]);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  };

  const steps: Step[] = [
    {
      icon: Zap,
      color: 'text-white',
      bg: 'from-indigo-500 to-purple-600',
      title: t('Добро пожаловать в Clarity Space!', 'Welcome to Clarity Space!'),
      desc: t(
        'AI-ассистент для предпринимателей. Записывай встречи, ставь задачи голосом, отслеживай цели. Ни одна идея не потеряется.',
        'AI assistant for entrepreneurs. Record meetings, set tasks by voice, track goals. No idea gets lost.',
      ),
      tip: t('Обзор займёт 2 минуты', 'This tour takes 2 minutes'),
    },
    {
      icon: Mic,
      color: 'text-indigo-500',
      bg: 'from-indigo-50 to-indigo-100 dark:from-indigo-900/30 dark:to-indigo-800/20',
      title: t('Транскрибация встреч', 'Meeting Transcription'),
      desc: t(
        'Отправь аудио боту в Telegram — он расшифрует, создаст резюме, Notes и Q&A. Задачи попадут в бэклог автоматически.',
        'Send audio to the Telegram bot — it transcribes, creates summary, Notes and Q&A. Tasks go to backlog automatically.',
      ),
      tip: t('Команда /lecture — для лекций и учебных материалов', '/lecture command — for lectures and study materials'),
      action: { label: t('Встречи', 'Meetings'), route: '/meetings' },
    },
    {
      icon: Columns3,
      color: 'text-blue-500',
      bg: 'from-blue-50 to-blue-100 dark:from-blue-900/30 dark:to-blue-800/20',
      title: t('Kanban-доска', 'Kanban Board'),
      desc: t(
        'Перетаскивай задачи между колонками: Бэклог → Todo → В работе → Готово. Подзадачи, исполнители, приоритеты.',
        'Drag tasks between columns: Backlog → Todo → In Progress → Done. Subtasks, assignees, priorities.',
      ),
      tip: t('Свайпай задачи на мобиле — как в Tinder!', 'Swipe tasks on mobile — like Tinder!'),
      action: { label: t('Открыть доску', 'Open board'), route: '/' },
    },
    {
      icon: MessageCircle,
      color: 'text-purple-500',
      bg: 'from-purple-50 to-purple-100 dark:from-purple-900/30 dark:to-purple-800/20',
      title: t('AI-ассистент', 'AI Assistant'),
      desc: t(
        'Спроси что угодно: "Какие задачи на сегодня?", "Что обсуждали на встрече?". Создавай задачи и встречи голосом. Бот подбадривает и мотивирует!',
        'Ask anything: "What tasks today?", "What was discussed at the meeting?". Create tasks and meetings by voice. Bot encourages and motivates!',
      ),
      tip: t('Работает в Telegram и в веб-приложении', 'Works in Telegram and web app'),
    },
    {
      icon: Target,
      color: 'text-rose-500',
      bg: 'from-rose-50 to-rose-100 dark:from-rose-900/30 dark:to-rose-800/20',
      title: t('Цели и Mind Map', 'Goals & Mind Map'),
      desc: t(
        'Поставь BHAG — большую амбициозную цель. AI разложит на milestones и задачи. Интерактивная Mind Map показывает путь к результату.',
        'Set a BHAG — a big ambitious goal. AI decomposes it into milestones and tasks. Interactive Mind Map shows the path to results.',
      ),
      action: { label: t('Цели', 'Goals'), route: '/goals' },
    },
    {
      icon: Flame,
      color: 'text-orange-500',
      bg: 'from-orange-50 to-orange-100 dark:from-orange-900/30 dark:to-orange-800/20',
      title: t('Привычки', 'Habits'),
      desc: t(
        'Тапни — и привычка отмечена. Стрики мотивируют не пропускать. Бот напоминает и хвалит за прогресс.',
        'Tap — habit checked. Streaks motivate consistency. Bot reminds and praises progress.',
      ),
      action: { label: t('Привычки', 'Habits'), route: '/habits' },
    },
    {
      icon: CalendarDays,
      color: 'text-cyan-500',
      bg: 'from-cyan-50 to-cyan-100 dark:from-cyan-900/30 dark:to-cyan-800/20',
      title: t('Календарь', 'Calendar'),
      desc: t(
        'День, 3 дня, неделя, месяц — как в Google Calendar. Синхронизация с Google Calendar. Задачи и встречи на одном экране.',
        'Day, 3-day, week, month — like Google Calendar. Google Calendar sync. Tasks and meetings on one screen.',
      ),
      action: { label: t('Календарь', 'Calendar'), route: '/calendar' },
    },
    {
      icon: GanttChart,
      color: 'text-emerald-500',
      bg: 'from-emerald-50 to-emerald-100 dark:from-emerald-900/30 dark:to-emerald-800/20',
      title: t('Ещё возможности', 'More Features'),
      desc: t(
        'Диаграмма Ганта • Документы как в Notion • CRM контактов • Банк идей • Obsidian синхронизация • Дашборд • AI-план дня • Дневник • Статистика',
        'Gantt Chart • Notion-like Docs • Contact CRM • Idea Bank • Obsidian Sync • Dashboard • AI Daily Plan • Journal • Statistics',
      ),
    },
    {
      icon: Smartphone,
      color: 'text-indigo-500',
      bg: 'from-indigo-50 to-indigo-100 dark:from-indigo-900/30 dark:to-indigo-800/20',
      title: t('Быстрый старт', 'Quick Start'),
      desc: t(
        '1. Создай проект в боковом меню\n2. Добавь первую задачу на Kanban-доске\n3. Попробуй AI-чат — спроси "Какие задачи?"\n4. Отправь аудио боту в Telegram',
        '1. Create a project in the sidebar\n2. Add your first task on the Kanban board\n3. Try AI chat — ask "What tasks?"\n4. Send audio to the Telegram bot',
      ),
      tip: t('Ctrl+K — быстрое создание • ? — горячие клавиши', 'Ctrl+K — quick create • ? — keyboard shortcuts'),
    },
  ];

  const current = steps[step]!;
  const Icon = current.icon;
  const isFirst = step === 0;
  const isLast = step === steps.length - 1;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden relative">
        {/* Close */}
        <button onClick={dismiss} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer z-10">
          <X size={20} />
        </button>

        {/* Skip */}
        {!isLast && (
          <button onClick={dismiss} className="absolute top-4 left-4 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer">
            {t('Пропустить', 'Skip')}
          </button>
        )}

        {/* Icon area */}
        <div className={`px-8 pt-10 pb-6 text-center ${isFirst ? '' : ''}`}>
          <div className={`mx-auto w-20 h-20 rounded-2xl bg-gradient-to-br ${current.bg} flex items-center justify-center mb-5 ${isFirst ? 'shadow-lg shadow-indigo-500/20' : ''}`}>
            {isFirst ? (
              <span className="text-white font-bold text-3xl">CS</span>
            ) : (
              <Icon size={36} className={current.color} strokeWidth={1.6} />
            )}
          </div>

          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-3">{current.title}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed whitespace-pre-line">{current.desc}</p>

          {/* Tip */}
          {current.tip && (
            <div className="mt-4 inline-flex items-center gap-1.5 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded-full px-3.5 py-1.5 text-xs font-medium">
              <Brain size={13} />
              {current.tip}
            </div>
          )}

          {/* Action button */}
          {current.action && (
            <button
              onClick={() => { dismiss(); navigate(current.action!.route); }}
              className="mt-4 mx-auto flex items-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 cursor-pointer font-medium"
            >
              {current.action.label} <ArrowRight size={13} />
            </button>
          )}
        </div>

        {/* Progress bar */}
        <div className="px-8 pb-3">
          <div className="h-1 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-300"
              style={{ width: `${((step + 1) / steps.length) * 100}%` }}
            />
          </div>
          <div className="text-[10px] text-gray-400 text-center mt-1.5">
            {step + 1} / {steps.length}
          </div>
        </div>

        {/* Buttons */}
        <div className="px-8 pb-8 flex gap-3">
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)}
              className="flex-1 py-2.5 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-xl cursor-pointer transition-colors">
              {t('Назад', 'Back')}
            </button>
          )}
          {!isLast ? (
            <button onClick={() => setStep(s => s + 1)}
              className="flex-1 py-2.5 text-sm bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 cursor-pointer font-medium transition-colors">
              {t('Далее', 'Next')}
            </button>
          ) : (
            <button onClick={dismiss}
              className="flex-1 py-2.5 text-sm bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl hover:from-indigo-700 hover:to-purple-700 cursor-pointer font-semibold transition-all">
              {t('Начать работу!', 'Get Started!')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Trigger onboarding from settings/menu — no reload needed */
export function resetOnboarding(): void {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(ONBOARDING_EVENT));
}
