import { useEffect, useState } from 'react';
import { aiApi } from '../api/ai.api';
import { useTasksStore, useProjectsStore } from '../store';
import type { Task } from '@pis/shared';

export function DailyBriefPage() {
  const { tasks, fetchTasks } = useTasksStore();
  const { projects, fetchProjects } = useProjectsStore();
  const [brief, setBrief] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);

  useEffect(() => { fetchTasks(); fetchProjects(); }, [fetchTasks, fetchProjects]);

  const today = new Date().toISOString().split('T')[0]!;
  const projectMap = new Map(projects.map(p => [p.id, p]));

  // Categorize tasks
  const overdue = tasks.filter(t => !t.archived && t.due_date && t.due_date < today && t.status !== 'done' && t.status !== 'someday');
  const todayTasks = tasks.filter(t => !t.archived && t.due_date === today && t.status !== 'done' && t.status !== 'someday');
  const inProgress = tasks.filter(t => !t.archived && t.status === 'in_progress');
  const highPriority = tasks.filter(t => !t.archived && t.priority >= 4 && t.status !== 'done' && t.status !== 'someday');

  const generateBrief = async () => {
    setLoading(true);
    try {
      const result = await aiApi.dailyBrief();
      setBrief(result.brief);
      setGenerated(true);
    } catch (err) {
      setBrief('Failed to generate brief. Check OpenAI API key.');
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
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Daily Brief</h1>
          <p className="text-sm text-gray-400">{new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <button onClick={generateBrief} disabled={loading}
          className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50">
          {loading ? 'Generating...' : generated ? 'Regenerate' : 'Generate AI Brief'}
        </button>
      </div>

      {brief && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 mb-6">
          <div className="text-sm text-gray-700 whitespace-pre-wrap">{brief}</div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {overdue.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-red-700 mb-3">Overdue ({overdue.length})</h3>
            <TaskList items={overdue} emptyText="" />
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Today ({todayTasks.length})</h3>
          <TaskList items={todayTasks} emptyText="No tasks due today" />
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">In Progress ({inProgress.length})</h3>
          <TaskList items={inProgress} emptyText="Nothing in progress" />
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">High Priority ({highPriority.length})</h3>
          <TaskList items={highPriority} emptyText="No high priority tasks" />
        </div>
      </div>
    </div>
  );
}
