import { useEffect, useState } from 'react';
import { aiApi } from '../api/ai.api';
import { useTasksStore, useProjectsStore } from '../store';
import { useLangStore } from '../store/lang.store';
import { Sun } from 'lucide-react';
import type { Task } from '@pis/shared';

export function DailyBriefPage() {
  const { t } = useLangStore();
  const { tasks, fetchTasks } = useTasksStore();
  const { projects, fetchProjects } = useProjectsStore();
  const [brief, setBrief] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);

  useEffect(() => { fetchTasks(); fetchProjects(); }, [fetchTasks, fetchProjects]);

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const weekEnd = new Date(now); weekEnd.setDate(now.getDate() + 7);
  const weekEndStr = `${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, '0')}-${String(weekEnd.getDate()).padStart(2, '0')}`;
  const projectMap = new Map(projects.map(p => [p.id, p]));

  // Categorize tasks
  const overdue = tasks.filter(t => !t.archived && t.due_date && t.due_date < today && t.status !== 'done' && t.status !== 'someday');
  const todayTasks = tasks.filter(t => !t.archived && t.due_date === today && t.status !== 'done' && t.status !== 'someday');
  const weekTasks = tasks.filter(t => !t.archived && t.due_date && t.due_date > today && t.due_date <= weekEndStr && t.status !== 'done' && t.status !== 'someday');
  const inProgress = tasks.filter(t => !t.archived && t.status === 'in_progress');
  const highPriority = tasks.filter(t => !t.archived && t.priority >= 4 && t.status !== 'done' && t.status !== 'someday');

  const generateBrief = async () => {
    setLoading(true);
    try {
      const result = await aiApi.dailyBrief();
      setBrief(result.brief);
      setGenerated(true);
    } catch (err) {
      setBrief(t('Не удалось сгенерировать брифинг. Проверьте API-ключ OpenAI.', 'Failed to generate brief. Please check your OpenAI API key.'));
    } finally { setLoading(false); }
  };

  const TaskList = ({ items, emptyText }: { items: Task[]; emptyText: string }) => (
    items.length === 0 ? <div className="text-gray-400 text-sm">{emptyText}</div> : (
      <div className="space-y-1.5">
        {items.map(t => {
          const proj = t.project_id ? projectMap.get(t.project_id) : null;
          return (
            <div key={t.id} className="flex items-center gap-2 text-sm">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${t.priority >= 4 ? 'bg-red-500' : t.priority === 3 ? 'bg-yellow-500' : 'bg-gray-300'}`} />
              <span className="text-gray-800">{t.title}</span>
              {proj && <span className="text-[10px] px-1.5 py-0.5 rounded-full text-white ml-auto flex-shrink-0" style={{ backgroundColor: proj.color }}>{proj.name}</span>}
              {t.due_date && <span className={`text-xs flex-shrink-0 ${t.due_date < today ? 'text-red-500 font-medium' : 'text-gray-400'}`}>{t.due_date}</span>}
            </div>
          );
        })}
      </div>
    )
  );

  return (
    <div className="relative overflow-hidden p-6 max-w-3xl">
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full border-4 border-indigo-400/30 dark:border-white/[0.12]" style={{ animation: 'circleLeft 16s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute -top-20 -right-20 w-[350px] h-[350px] rounded-full border-4 border-purple-400/35 dark:border-white/[0.12]" style={{ animation: 'circleLeftSlow 12s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] h-[500px] rounded-full bg-indigo-400/[0.14] dark:bg-white/[0.06] blur-[80px]" style={{ animation: 'circleRight 20s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="relative z-10 flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-yellow-500 to-yellow-600 flex items-center justify-center shadow-lg shadow-yellow-500/25">
              <Sun size={20} className="text-white" />
            </div>
            <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('Дневной брифинг', 'Daily Brief')}</h1>
          </div>
          <p className="text-sm text-gray-400">{new Date().toLocaleDateString(t('ru-RU', 'en-US'), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <button onClick={generateBrief} disabled={loading}
          className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50">
          {loading ? t('Генерация...', 'Generating...') : generated ? t('Перегенерировать', 'Regenerate') : t('Сгенерировать AI-брифинг', 'Generate AI Brief')}
        </button>
      </div>

      {brief && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 mb-6">
          <div className="text-sm text-gray-700 whitespace-pre-wrap">{brief}</div>
        </div>
      )}

      <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 gap-6">
        {overdue.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-red-700 mb-3">{t('Просрочено', 'Overdue')} ({overdue.length})</h3>
            <TaskList items={overdue} emptyText="" />
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('Сегодня', 'Today')} ({todayTasks.length})</h3>
          <TaskList items={todayTasks} emptyText={t('Нет задач на сегодня', 'No tasks for today')} />
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('В работе', 'In Progress')} ({inProgress.length})</h3>
          <TaskList items={inProgress} emptyText={t('Нет задач в работе', 'No tasks in progress')} />
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-blue-700 mb-3">{t('На неделе', 'This Week')} ({weekTasks.length})</h3>
          <TaskList items={weekTasks} emptyText={t('Нет задач на неделю', 'No tasks this week')} />
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('Высокий приоритет', 'High Priority')} ({highPriority.length})</h3>
          <TaskList items={highPriority} emptyText={t('Нет задач с высоким приоритетом', 'No high priority tasks')} />
        </div>
      </div>
    </div>
  );
}
