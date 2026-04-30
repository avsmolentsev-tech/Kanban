import { useEffect, useState, useRef } from 'react';
import { aiApi } from '../api/ai.api';
import { useTasksStore, useProjectsStore } from '../store';
import { useLangStore } from '../store/lang.store';
import { Sun, Check, Calendar, Clock, ArrowRight } from 'lucide-react';
import { TaskDetailPanel } from '../components/kanban/TaskDetailPanel';
import { peopleApi } from '../api/people.api';
import { tasksApi } from '../api/tasks.api';
import type { Task, Person } from '@pis/shared';

export function DailyBriefPage() {
  const { t } = useLangStore();
  const { tasks, fetchTasks } = useTasksStore();
  const { projects, fetchProjects } = useProjectsStore();
  const [brief, setBrief] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [people, setPeople] = useState<Person[]>([]);

  useEffect(() => { fetchTasks(); fetchProjects(); peopleApi.list().then(setPeople).catch(() => {}); }, [fetchTasks, fetchProjects]);

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

  const handleTaskUpdated = () => {
    fetchTasks();
  };

  const localDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const markDone = async (e: React.MouseEvent, task: Task) => {
    e.stopPropagation();
    await tasksApi.update(task.id, { status: 'done' });
    fetchTasks();
  };

  const setDueDate = async (e: React.MouseEvent, task: Task, offset: 'today' | 'tomorrow' | 'week') => {
    e.stopPropagation();
    const d = new Date();
    if (offset === 'tomorrow') d.setDate(d.getDate() + 1);
    else if (offset === 'week') d.setDate(d.getDate() + 7);
    await tasksApi.update(task.id, { due_date: localDateStr(d) });
    fetchTasks();
  };

  const setCustomDate = async (e: React.ChangeEvent<HTMLInputElement>, task: Task) => {
    e.stopPropagation();
    if (e.target.value) {
      await tasksApi.update(task.id, { due_date: e.target.value });
      fetchTasks();
    }
  };

  const startInProgress = async (e: React.MouseEvent, task: Task) => {
    e.stopPropagation();
    await tasksApi.update(task.id, { status: 'in_progress' });
    fetchTasks();
  };

  const TaskList = ({ items, emptyText }: { items: Task[]; emptyText: string }) => (
    items.length === 0 ? <div className="text-gray-400 text-sm">{emptyText}</div> : (
      <div className="space-y-0.5">
        {items.map(task => {
          const proj = task.project_id ? projectMap.get(task.project_id) : null;
          return (
            <div
              key={task.id}
              className="flex items-center gap-2 text-sm rounded-lg px-2 py-1.5 -mx-2 hover:bg-black/5 dark:hover:bg-white/5 transition-colors group"
            >
              {/* Done checkbox */}
              <button
                onClick={(e) => markDone(e, task)}
                className="w-5 h-5 rounded border-2 border-gray-300 dark:border-gray-600 hover:border-green-500 hover:bg-green-500/10 flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer"
                title={t('Выполнено', 'Done')}
              >
                <Check size={12} className="text-transparent group-hover:text-green-500 transition-colors" />
              </button>

              {/* Title — click opens detail panel */}
              <button
                onClick={() => setSelectedTask(task)}
                className="text-gray-800 dark:text-gray-200 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors truncate text-left cursor-pointer flex-1 min-w-0"
              >
                {task.title}
              </button>

              {/* Project badge */}
              {proj && <span className="text-[10px] px-1.5 py-0.5 rounded-full text-white flex-shrink-0" style={{ backgroundColor: proj.color }}>{proj.name}</span>}

              {/* Quick actions — visible on hover */}
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                {task.status !== 'in_progress' && (
                  <button onClick={(e) => startInProgress(e, task)} className="p-1 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/30 text-gray-400 hover:text-indigo-500 cursor-pointer" title={t('В работу', 'Start')}>
                    <ArrowRight size={13} />
                  </button>
                )}
                <button onClick={(e) => setDueDate(e, task, 'today')} className="px-1.5 py-0.5 rounded text-[10px] hover:bg-blue-100 dark:hover:bg-blue-900/30 text-gray-400 hover:text-blue-600 cursor-pointer" title={t('Сегодня', 'Today')}>
                  {t('Сег', 'Tod')}
                </button>
                <button onClick={(e) => setDueDate(e, task, 'tomorrow')} className="px-1.5 py-0.5 rounded text-[10px] hover:bg-blue-100 dark:hover:bg-blue-900/30 text-gray-400 hover:text-blue-600 cursor-pointer" title={t('Завтра', 'Tomorrow')}>
                  {t('Завт', 'Tmr')}
                </button>
                <button onClick={(e) => setDueDate(e, task, 'week')} className="px-1.5 py-0.5 rounded text-[10px] hover:bg-blue-100 dark:hover:bg-blue-900/30 text-gray-400 hover:text-blue-600 cursor-pointer" title={t('Через неделю', 'In a week')}>
                  {t('Нед', 'Wk')}
                </button>
                <label className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30 text-gray-400 hover:text-blue-600 cursor-pointer" title={t('Выбрать дату', 'Pick date')}>
                  <Calendar size={13} />
                  <input type="date" className="absolute opacity-0 w-0 h-0" onChange={(e) => setCustomDate(e, task)} onClick={(e) => e.stopPropagation()} />
                </label>
              </div>

              {/* Due date */}
              {task.due_date && <span className={`text-xs flex-shrink-0 ${task.due_date < today ? 'text-red-500 font-medium' : 'text-gray-400'}`}>{task.due_date.slice(5)}</span>}
            </div>
          );
        })}
      </div>
    )
  );

  return (
    <div className="relative overflow-hidden p-6 max-w-3xl">
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full bg-indigo-400/15 dark:bg-indigo-400/[0.10]" style={{ animation: 'circleLeft 30s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute -top-20 -right-20 w-[350px] h-[350px] rounded-full bg-purple-400/12 dark:bg-purple-400/[0.08]" style={{ animation: 'circleLeftSlow 26s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] h-[500px] rounded-full bg-indigo-400/[0.14] dark:bg-violet-400/[0.09] blur-[80px]" style={{ animation: 'circleRight 34s cubic-bezier(0.45,0,0.55,1) infinite' }} />
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
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-red-700 dark:text-red-400 mb-3">{t('Просрочено', 'Overdue')} ({overdue.length})</h3>
            <TaskList items={overdue} emptyText="" />
          </div>
        )}

        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">{t('Сегодня', 'Today')} ({todayTasks.length})</h3>
          <TaskList items={todayTasks} emptyText={t('Нет задач на сегодня', 'No tasks for today')} />
        </div>

        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">{t('В работе', 'In Progress')} ({inProgress.length})</h3>
          <TaskList items={inProgress} emptyText={t('Нет задач в работе', 'No tasks in progress')} />
        </div>

        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-blue-700 dark:text-blue-400 mb-3">{t('На неделе', 'This Week')} ({weekTasks.length})</h3>
          <TaskList items={weekTasks} emptyText={t('Нет задач на неделю', 'No tasks this week')} />
        </div>

        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">{t('Высокий приоритет', 'High Priority')} ({highPriority.length})</h3>
          <TaskList items={highPriority} emptyText={t('Нет задач с высоким приоритетом', 'No high priority tasks')} />
        </div>
      </div>

      <TaskDetailPanel
        task={selectedTask}
        projects={projects}
        people={people}
        onClose={() => setSelectedTask(null)}
        onUpdated={handleTaskUpdated}
        onDeleted={() => { setSelectedTask(null); fetchTasks(); }}
      />
    </div>
  );
}
