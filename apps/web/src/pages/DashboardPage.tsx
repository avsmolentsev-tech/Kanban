import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { apiGet, apiPost } from '../api/client';

interface Task {
  id: string;
  title: string;
  status: string;
  due_date?: string;
  project_id?: string;
}

interface Meeting {
  id: string;
  title: string;
  date: string;
}

interface Idea {
  id: string;
  title: string;
  created_at: string;
}

interface Project {
  id: string;
  name: string;
}

interface ProjectProgress {
  project: string;
  backlog: number;
  todo: number;
  in_progress: number;
  done: number;
}

function WidgetCard({
  title,
  linkTo,
  children,
}: {
  title: string;
  linkTo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-3">{title}</h2>
      <div className="space-y-2">{children}</div>
      <NavLink
        to={linkTo}
        className="inline-block mt-3 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
      >
        посмотреть все &rarr;
      </NavLink>
    </div>
  );
}

export function DashboardPage() {
  const [todayTasks, setTodayTasks] = useState<Task[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [progress, setProgress] = useState<ProjectProgress[]>([]);
  const [loading, setLoading] = useState(true);

  const [dailyPlan, setDailyPlan] = useState('');
  const [dailyPlanLoading, setDailyPlanLoading] = useState(false);
  const [productivityAnalysis, setProductivityAnalysis] = useState('');
  const [productivityLoading, setProductivityLoading] = useState(false);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);

    Promise.all([
      apiGet<Task[]>('/tasks').catch(() => [] as Task[]),
      apiGet<Meeting[]>('/meetings').catch(() => [] as Meeting[]),
      apiGet<Idea[]>('/ideas').catch(() => [] as Idea[]),
      apiGet<Project[]>('/projects').catch(() => [] as Project[]),
    ]).then(([tasks, mtgs, ideasData, projects]) => {
      // Today tasks: due today or in_progress
      const filtered = tasks
        .filter((t) => t.due_date?.slice(0, 10) === today || t.status === 'in_progress')
        .slice(0, 5);
      setTodayTasks(filtered);

      // Upcoming meetings sorted by date
      const upcoming = mtgs
        .filter((m) => m.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 5);
      setMeetings(upcoming);

      // Recent ideas (backlog)
      const recentIdeas = [...ideasData]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 5);
      setIdeas(recentIdeas);

      // Progress per project
      const proj = projects.map((p) => {
        const projectTasks = tasks.filter((t) => t.project_id === p.id);
        return {
          project: p.name,
          backlog: projectTasks.filter((t) => t.status === 'backlog').length,
          todo: projectTasks.filter((t) => t.status === 'todo').length,
          in_progress: projectTasks.filter((t) => t.status === 'in_progress').length,
          done: projectTasks.filter((t) => t.status === 'done').length,
        };
      });
      setProgress(proj);

      setLoading(false);
    });
  }, []);

  const handleGeneratePlan = async () => {
    setDailyPlanLoading(true);
    try {
      const data = await apiPost<{ plan: string }>('/ai/daily-plan');
      setDailyPlan(data.plan);
    } catch (err) {
      setDailyPlan('Ошибка генерации плана');
    } finally {
      setDailyPlanLoading(false);
    }
  };

  const handleProductivityAnalysis = async () => {
    setProductivityLoading(true);
    try {
      const data = await apiPost<{ analysis: string }>('/ai/productivity-analysis');
      setProductivityAnalysis(data.analysis);
    } catch (err) {
      setProductivityAnalysis('Ошибка анализа продуктивности');
    } finally {
      setProductivityLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 text-gray-500 dark:text-gray-400 text-center">Загрузка...</div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-5">Дашборд</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* AI Daily Plan */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-3">
            {'\uD83D\uDCC5'} План на день
          </h2>
          <div className="space-y-2">
            {!dailyPlan && !dailyPlanLoading && (
              <button
                onClick={handleGeneratePlan}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-lg transition-colors"
              >
                Сгенерировать
              </button>
            )}
            {dailyPlanLoading && (
              <p className="text-sm text-gray-400 dark:text-gray-500 animate-pulse">
                Генерация плана...
              </p>
            )}
            {dailyPlan && (
              <>
                <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap max-h-80 overflow-y-auto">
                  {dailyPlan}
                </div>
                <button
                  onClick={handleGeneratePlan}
                  disabled={dailyPlanLoading}
                  className="mt-2 px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                >
                  Обновить
                </button>
              </>
            )}
          </div>
        </div>

        {/* AI Productivity Analysis */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-3">
            {'\uD83D\uDCCA'} Анализ продуктивности
          </h2>
          <div className="space-y-2">
            {!productivityAnalysis && !productivityLoading && (
              <button
                onClick={handleProductivityAnalysis}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-lg transition-colors"
              >
                Анализировать
              </button>
            )}
            {productivityLoading && (
              <p className="text-sm text-gray-400 dark:text-gray-500 animate-pulse">
                Анализ данных...
              </p>
            )}
            {productivityAnalysis && (
              <>
                <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap max-h-80 overflow-y-auto">
                  {productivityAnalysis}
                </div>
                <button
                  onClick={handleProductivityAnalysis}
                  disabled={productivityLoading}
                  className="mt-2 px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                >
                  Обновить
                </button>
              </>
            )}
          </div>
        </div>

        {/* Today tasks */}
        <WidgetCard title="Задачи на сегодня" linkTo="/kanban">
          {todayTasks.length === 0 && (
            <p className="text-sm text-gray-400 dark:text-gray-500">Нет задач</p>
          )}
          {todayTasks.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between text-sm text-gray-700 dark:text-gray-300"
            >
              <span className="truncate">{t.title}</span>
              <span
                className={`ml-2 flex-shrink-0 px-2 py-0.5 rounded text-xs font-medium ${
                  t.status === 'in_progress'
                    ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                }`}
              >
                {t.status}
              </span>
            </div>
          ))}
        </WidgetCard>

        {/* Upcoming meetings */}
        <WidgetCard title="Ближайшие встречи" linkTo="/meetings">
          {meetings.length === 0 && (
            <p className="text-sm text-gray-400 dark:text-gray-500">Нет встреч</p>
          )}
          {meetings.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between text-sm text-gray-700 dark:text-gray-300"
            >
              <span className="truncate">{m.title}</span>
              <span className="ml-2 flex-shrink-0 text-xs text-gray-400 dark:text-gray-500">
                {new Date(m.date).toLocaleDateString('ru-RU', {
                  day: 'numeric',
                  month: 'short',
                })}
              </span>
            </div>
          ))}
        </WidgetCard>

        {/* Recent ideas */}
        <WidgetCard title="Новые идеи" linkTo="/ideas">
          {ideas.length === 0 && (
            <p className="text-sm text-gray-400 dark:text-gray-500">Нет идей</p>
          )}
          {ideas.map((idea) => (
            <div
              key={idea.id}
              className="text-sm text-gray-700 dark:text-gray-300 truncate"
            >
              {idea.title}
            </div>
          ))}
        </WidgetCard>

        {/* Project progress */}
        <WidgetCard title="Прогресс по проектам" linkTo="/timeline">
          {progress.length === 0 && (
            <p className="text-sm text-gray-400 dark:text-gray-500">Нет проектов</p>
          )}
          {progress.map((p) => {
            const total = p.backlog + p.todo + p.in_progress + p.done;
            const donePercent = total > 0 ? Math.round((p.done / total) * 100) : 0;
            return (
              <div key={p.project} className="space-y-1">
                <div className="flex items-center justify-between text-sm text-gray-700 dark:text-gray-300">
                  <span className="truncate font-medium">{p.project}</span>
                  <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
                    {p.done}/{total} ({donePercent}%)
                  </span>
                </div>
                <div className="w-full h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden flex">
                  {p.done > 0 && (
                    <div
                      className="bg-green-500 h-full"
                      style={{ width: `${(p.done / total) * 100}%` }}
                    />
                  )}
                  {p.in_progress > 0 && (
                    <div
                      className="bg-blue-500 h-full"
                      style={{ width: `${(p.in_progress / total) * 100}%` }}
                    />
                  )}
                  {p.todo > 0 && (
                    <div
                      className="bg-yellow-400 h-full"
                      style={{ width: `${(p.todo / total) * 100}%` }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </WidgetCard>
      </div>
    </div>
  );
}
