import { useState } from 'react';
import { apiPost } from '../../api/client';
import { X, Sparkles } from 'lucide-react';

const TEMPLATES = [
  {
    id: 'product-launch',
    name: 'Запуск продукта',
    icon: '🚀',
    description: 'MVP → Пилот → Масштабирование',
    milestones: ['Исследование рынка и MVP', 'Пилотные продажи', 'Масштабирование и маркетинг', 'Оптимизация и сервис'],
  },
  {
    id: 'revenue-growth',
    name: 'Рост выручки',
    icon: '💰',
    description: 'Клиенты → Продажи → Партнёры → Масштаб',
    milestones: ['Привлечение первых клиентов', 'Построение воронки продаж', 'Партнёрская сеть', 'Масштабирование'],
  },
  {
    id: 'personal',
    name: 'Личная продуктивность',
    icon: '🧠',
    description: 'Привычки → Навыки → Результаты',
    milestones: ['Формирование привычек', 'Развитие навыков', 'Достижение результатов', 'Рефлексия и корректировка'],
  },
  {
    id: 'team-build',
    name: 'Построение команды',
    icon: '👥',
    description: 'Найм → Онбординг → Процессы → Культура',
    milestones: ['Найм ключевых людей', 'Онбординг и обучение', 'Выстраивание процессов', 'Развитие культуры'],
  },
  {
    id: 'custom',
    name: 'AI декомпозиция',
    icon: '✨',
    description: 'Claude сам предложит milestones',
    milestones: [],
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function DecomposeModal({ open, onClose, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'input' | 'template' | 'decomposing' | 'done'>('input');

  if (!open) return null;

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setStep('input');
    setLoading(false);
  };

  const handleNext = () => {
    if (!title.trim()) return;
    setStep('template');
  };

  const handleTemplateCreate = async (template: typeof TEMPLATES[0]) => {
    if (!title.trim()) return;
    setLoading(true);
    setStep('decomposing');
    try {
      const createResp = await apiPost<{ id: number }>('/goals', {
        title,
        description,
        type: 'bhag',
        due_date: `${new Date().getFullYear()}-12-31`,
      });
      const bhagId = createResp.id;

      if (template.milestones.length > 0) {
        // Create milestones from template (no Claude needed)
        const monthsPerMilestone = Math.floor(12 / template.milestones.length);
        for (let i = 0; i < template.milestones.length; i++) {
          const dueMonth = Math.min(12, (i + 1) * monthsPerMilestone);
          const dueDate = `${new Date().getFullYear()}-${String(dueMonth).padStart(2, '0')}-28`;
          await apiPost('/goals', {
            title: template.milestones[i],
            type: 'milestone',
            parent_id: bhagId,
            due_date: dueDate,
          });
        }
      } else {
        // AI decomposition
        await apiPost(`/goals/${bhagId}/decompose`, {});
      }

      setStep('done');
      setTimeout(() => { onCreated(); onClose(); resetForm(); }, 1500);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error');
      setStep('input');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg p-6 mx-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Новая BHAG</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>

        {step === 'input' && (
          <>
            <input
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 mb-3 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              placeholder="Большая цель на год..."
              value={title}
              onChange={e => setTitle(e.target.value)}
              autoFocus
            />
            <textarea
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 mb-4 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              placeholder="Контекст, почему это важно... (необязательно)"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
            />
            <button
              onClick={handleNext}
              disabled={!title.trim() || loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
            >
              <Sparkles size={18} /> Далее — выбрать шаблон
            </button>
          </>
        )}

        {step === 'template' && (
          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Выбери шаблон декомпозиции:</h3>
            <div className="grid grid-cols-1 gap-2">
              {TEMPLATES.map(t => (
                <button
                  key={t.id}
                  onClick={() => handleTemplateCreate(t)}
                  className="text-left p-3 border rounded-xl hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 dark:border-gray-600 transition-all"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{t.icon}</span>
                    <div>
                      <div className="font-medium text-sm text-gray-900 dark:text-white">{t.name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{t.description}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'decomposing' && (
          <div className="flex flex-col items-center py-8 text-gray-500 dark:text-gray-400">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-600 mb-4" />
            <p>AI декомпозирует цель на milestones и задачи...</p>
          </div>
        )}

        {step === 'done' && (
          <div className="flex flex-col items-center py-8">
            <p className="text-gray-700 dark:text-gray-300 text-lg font-semibold mb-1">BHAG создана и декомпозирована!</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">Переключаюсь на Mind Map...</p>
          </div>
        )}
      </div>
    </div>
  );
}
