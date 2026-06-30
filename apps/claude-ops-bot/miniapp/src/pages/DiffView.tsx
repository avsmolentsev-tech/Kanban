import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function DiffView({ taskId, onBack }: { taskId: number; onBack: () => void }) {
  const [diff, setDiff] = useState<string | null>(null);

  useEffect(() => {
    api.diff(taskId).then((d) => setDiff(d.diff)).catch(() => setDiff('Failed to load diff'));
  }, [taskId]);

  if (diff === null) return <div className="p-4 text-gray-400">Загрузка...</div>;

  return (
    <div className="p-4">
      <button onClick={onBack} className="text-cyan-400 text-sm mb-4">← Назад</button>
      <h1 className="text-lg font-bold text-white mb-4">Diff · #{taskId}</h1>
      <pre className="text-xs font-mono overflow-x-auto p-3 rounded-xl bg-black/50 border border-white/10">
        {diff.split('\n').map((line, i) => {
          let cls = 'text-gray-400';
          if (line.startsWith('+') && !line.startsWith('+++')) cls = 'text-green-400';
          else if (line.startsWith('-') && !line.startsWith('---')) cls = 'text-red-400';
          else if (line.startsWith('@@')) cls = 'text-cyan-400';
          else if (line.startsWith('diff')) cls = 'text-yellow-400 font-bold';
          return <div key={i} className={cls}>{line || ' '}</div>;
        })}
      </pre>
    </div>
  );
}
