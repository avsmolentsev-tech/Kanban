import { useState } from 'react';
import { Landmark, Zap, Handshake, MessageCircle, Flame } from 'lucide-react';
import { useLangStore } from '../store/lang.store';

const INTRO_KEY = 'cs_intro_seen_v1';

export function WelcomeIntro() {
  const { t } = useLangStore();
  const [open, setOpen] = useState(() => {
    try { return !localStorage.getItem(INTRO_KEY); } catch { return false; }
  });
  if (!open) return null;

  const close = () => {
    try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* ignore */ }
    setOpen(false);
  };

  const features = [
    { Icon: Landmark, title: t('Совет директоров', 'Advisory Board'), desc: t('Обсуждай встречи и решения с ИИ-персонами (Джобс, Маск, Тиньков…) и получай общий вердикт.', 'Discuss meetings & decisions with AI personas and get a collective verdict.') },
    { Icon: Handshake, title: t('Договорённости', 'Commitments'), desc: t('Трекер «кто кому что обещал» — автоматически из разборов встреч.', 'Who owes whom — auto-tracked from meetings.') },
    { Icon: Zap, title: t('Свайп задач', 'Swipe tasks'), desc: t('Свайп влево — удалить, вправо — готово. В Kanban и Таймлайне.', 'Swipe left to delete, right to complete. In Kanban & Timeline.') },
    { Icon: MessageCircle, title: t('Командный чат', 'Command chat'), desc: t('«Убери всё по роботам из приоритета» — AI сделает пачкой.', 'Manage tasks by natural language, in bulk.') },
    { Icon: Flame, title: t('Привычки', 'Habits'), desc: t('AI напомнит про несделанное: «уже 10 утра, зарядку не отметил?»', 'The assistant nudges about undone habits.') },
  ];

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onClick={close}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-md w-full max-h-[85vh] overflow-auto p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="text-center mb-5">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mb-3 shadow-lg shadow-indigo-500/25">
            <span className="text-white font-bold">CS</span>
          </div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('Добро пожаловать в Clarity Space', 'Welcome to Clarity Space')}</h2>
          <p className="text-xs text-gray-400 mt-1">{t('Коротко о главных возможностях', 'A quick tour of the key features')}</p>
        </div>

        <div className="space-y-3.5">
          {features.map((f, i) => (
            <div key={i} className="flex gap-3">
              <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
                <f.Icon size={18} className="text-indigo-600 dark:text-indigo-400" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">{f.title}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>

        <button onClick={close} className="mt-6 w-full py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors">
          {t('Погнали!', "Let's go!")} 🚀
        </button>
      </div>
    </div>
  );
}
