import { useEffect, useState } from 'react';
import { api, type Task } from '../lib/api';

export function TaskDetail({ taskId, onBack, onDiff }: { taskId: number; onBack: () => void; onDiff: () => void }) {
  const [task, setTask] = useState<(Task & { events: any[] }) | null>(null);

  useEffect(() => {
    api.task(taskId).then(setTask);
  }, [taskId]);

  if (!task) return <div className="p-4 text-gray-400">Загрузка...</div>;

  const duration = task.duration_ms
    ? task.duration_ms > 60000
      ? `${Math.floor(task.duration_ms / 60000)}м ${Math.round((task.duration_ms % 60000) / 1000)}с`
      : `${Math.round(task.duration_ms / 1000)}с`
    : null;

  return (
    <div className="p-4 space-y-4">
      <button onClick={onBack} className="text-cyan-400 text-sm">← Назад</button>
      <div>
        <h1 className="text-lg font-bold text-white">Задача #{task.id}</h1>
        <p className="text-sm text-gray-400">{task.project_name} · {task.model} {duration && `· ${duration}`}</p>
      </div>
      <div className="p-3 rounded-xl bg-white/5 border border-white/10">
        <p className="text-sm text-gray-300">{task.prompt}</p>
      </div>
      {task.result_summary && (
        <div>
          <h2 className="text-sm font-bold text-gray-300 mb-1">Результат</h2>
          <p className="text-sm text-gray-400">{task.result_summary}</p>
        </div>
      )}
      {task.diff_stat && (
        <div>
          <h2 className="text-sm font-bold text-gray-300 mb-1">Файлы</h2>
          {JSON.parse(task.diff_stat).map((f: any) => (
            <div key={f.path} className="text-xs font-mono text-gray-400">
              <span className="text-green-400">+{f.added}</span>{' '}
              <span className="text-red-400">-{f.removed}</span>{' '}
              {f.path}
            </div>
          ))}
          <button onClick={onDiff} className="mt-2 text-sm text-cyan-400 underline">Посмотреть diff</button>
        </div>
      )}
      {task.test_result && (
        <div>
          <h2 className="text-sm font-bold text-gray-300 mb-1">Тесты</h2>
          <pre className="text-xs text-gray-400 whitespace-pre-wrap">{task.test_result}</pre>
        </div>
      )}
    </div>
  );
}
