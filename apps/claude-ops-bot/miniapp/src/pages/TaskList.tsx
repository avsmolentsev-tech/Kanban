import { useEffect, useState } from 'react';
import { api, type Task } from '../lib/api';

const STATE_EMOJI: Record<string, string> = {
  CREATED: '🆕', PLANNING: '🧠', PLAN_GATE: '🧭', RUNNING: '🚀',
  VERIFYING: '🧪', DONE: '✅', FAILED: '❌', REJECTED: '🚫',
};

export function TaskList({ onSelect }: { onSelect: (id: number) => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.tasks().then(setTasks).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-4 text-center text-gray-400">Загрузка...</div>;
  if (tasks.length === 0) return <div className="p-4 text-center text-gray-400">Нет задач</div>;

  return (
    <div className="p-4 space-y-2">
      <h1 className="text-lg font-bold text-white mb-4">Задачи</h1>
      {tasks.map((t) => (
        <button
          key={t.id}
          onClick={() => onSelect(t.id)}
          className="w-full text-left p-3 rounded-xl bg-white/5 border border-white/10 hover:border-cyan-500/30 transition"
        >
          <div className="flex items-center gap-2">
            <span>{STATE_EMOJI[t.state] ?? '❓'}</span>
            <span className="font-medium text-white">#{t.id}</span>
            <span className="text-gray-400">{t.project_name}</span>
            <span className="ml-auto text-xs text-gray-500">{t.state}</span>
          </div>
          <p className="text-sm text-gray-400 mt-1 truncate">{t.prompt}</p>
        </button>
      ))}
    </div>
  );
}
