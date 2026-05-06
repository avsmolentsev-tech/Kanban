import { useState } from 'react';
import { useLangStore } from '../../store/lang.store';
import { Columns3, Users, FileText, MessageCircle, Zap, X } from 'lucide-react';

const STORAGE_KEY = 'clarity-onboarding-seen';

export function OnboardingWelcome() {
  const { t } = useLangStore();
  const [visible, setVisible] = useState(() => !localStorage.getItem(STORAGE_KEY));
  const [step, setStep] = useState(0);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  };

  const steps = [
    {
      icon: <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg"><span className="text-white font-bold text-2xl">CS</span></div>,
      title: t('Добро пожаловать в Clarity Space!', 'Welcome to Clarity Space!'),
      desc: t(
        'Ваша персональная система управления. Все идеи и договорённости под контролем — фокус на главном.',
        'Your personal intelligence system. All ideas and agreements under control — focus on what matters.'
      ),
    },
    {
      icon: <Columns3 size={40} className="text-indigo-500" />,
      title: t('5 способов видеть задачи', '5 ways to view tasks'),
      desc: t(
        'Kanban, Timeline, Gantt, Calendar, Swipe. Выберите удобный вид в боковом меню.',
        'Kanban, Timeline, Gantt, Calendar, Swipe. Pick your favorite view from the sidebar.'
      ),
    },
    {
      icon: <Users size={40} className="text-emerald-500" />,
      title: t('Встречи с AI-интеллектом', 'Meetings with AI intelligence'),
      desc: t(
        'Отправьте аудио в Telegram-бот — получите Notes и Q&A. Выберите задачи для бэклога.',
        'Send audio to Telegram bot — get Notes and Q&A reports. Pick tasks for your backlog.'
      ),
    },
    {
      icon: <MessageCircle size={40} className="text-purple-500" />,
      title: t('Telegram-бот и голос', 'Telegram bot & voice'),
      desc: t(
        'Управляйте задачами голосом. Создавайте, переносите, спрашивайте — бот всё понимает.',
        'Manage tasks by voice. Create, reschedule, ask — the bot understands everything.'
      ),
    },
    {
      icon: <Zap size={40} className="text-amber-500" />,
      title: t('Быстрый старт', 'Quick start'),
      desc: t(
        'Нажмите Ctrl+K для быстрого создания задач. Нажмите ? для горячих клавиш. Начните с создания проекта!',
        'Press Ctrl+K for quick task creation. Press ? for keyboard shortcuts. Start by creating a project!'
      ),
    },
  ];

  const current = steps[step]!;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Close button */}
        <button onClick={dismiss} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 cursor-pointer">
          <X size={20} />
        </button>

        {/* Content */}
        <div className="px-8 pt-10 pb-6 text-center">
          <div className="flex justify-center mb-6">{current.icon}</div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-3">{current.title}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{current.desc}</p>
        </div>

        {/* Progress dots */}
        <div className="flex justify-center gap-2 pb-4">
          {steps.map((_, i) => (
            <div key={i} className={`w-2 h-2 rounded-full transition-colors ${i === step ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700'}`} />
          ))}
        </div>

        {/* Buttons */}
        <div className="px-8 pb-8 flex gap-3">
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)}
              className="flex-1 py-2.5 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer">
              {t('Назад', 'Back')}
            </button>
          )}
          {step < steps.length - 1 ? (
            <button onClick={() => setStep(s => s + 1)}
              className="flex-1 py-2.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 cursor-pointer font-medium">
              {t('Далее', 'Next')}
            </button>
          ) : (
            <button onClick={dismiss}
              className="flex-1 py-2.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 cursor-pointer font-medium">
              {t('Начать работу!', 'Get started!')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
