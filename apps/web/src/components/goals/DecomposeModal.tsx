import { useState } from 'react';
import { apiPost } from '../../api/client';
import { X, Sparkles } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function DecomposeModal({ open, onClose, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'input' | 'decomposing' | 'done'>('input');

  if (!open) return null;

  const handleCreate = async () => {
    if (!title.trim()) return;
    setLoading(true);
    setStep('decomposing');
    try {
      // 1. Create BHAG
      const created = await apiPost<{ id: number }>('/goals', {
        title,
        description,
        type: 'bhag',
        due_date: `${new Date().getFullYear()}-12-31`,
      });
      const bhagId = created.id;

      // 2. Decompose via AI
      await apiPost(`/goals/${bhagId}/decompose`, {});
      setStep('done');
      setTimeout(() => {
        onCreated();
        onClose();
        setTitle('');
        setDescription('');
        setStep('input');
      }, 1500);
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
              onClick={handleCreate}
              disabled={!title.trim() || loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
            >
              <Sparkles size={18} /> Создать и декомпозировать
            </button>
          </>
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
