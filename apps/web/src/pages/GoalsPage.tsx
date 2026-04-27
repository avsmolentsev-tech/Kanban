import { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api/client';
import { useProjectsStore } from '../store/projects.store';
import { useLangStore } from '../store/lang.store';
import { Target } from 'lucide-react';
import { MindMapTab } from '../components/goals/MindMapTab';
import { DecomposeModal } from '../components/goals/DecomposeModal';

interface Goal {
  id: number;
  title: string;
  description: string;
  type: 'goal' | 'key_result' | 'bhag' | 'milestone';
  parent_id: number | null;
  project_id: number | null;
  target_value: number | null;
  current_value: number;
  unit: string;
  due_date: string | null;
  status: string;
  created_at: string;
  key_results?: Goal[];
}

function ProgressBar({ current, target, unit }: { current: number; target: number | null; unit: string }) {
  const t = target ?? 100;
  const pct = t > 0 ? Math.min(100, Math.round((current / t) * 100)) : 0;
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-2.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-green-500' : pct >= 60 ? 'bg-indigo-500' : 'bg-yellow-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">
        {current}/{t} {unit} ({pct}%)
      </span>
    </div>
  );
}

function AddGoalForm({ onSave, onCancel, parentId, projectId }: {
  onSave: (data: Partial<Goal>) => void; onCancel: () => void; parentId?: number; projectId?: number | null;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetValue, setTargetValue] = useState('100');
  const [unit, setUnit] = useState('%');
  const [dueDate, setDueDate] = useState('');
  const { projects } = useProjectsStore();
  const [projId, setProjId] = useState<number | null>(projectId ?? null);

  const { t } = useLangStore();

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-3">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('Название...', 'Title...')}
        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm" />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('Описание...', 'Description...')}
        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm" rows={2} />
      <div className="flex gap-2">
        <input type="number" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} placeholder={t('Цель', 'Target')}
          className="w-24 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm" />
        <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder={t('Единица', 'Unit')}
          className="w-20 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm" />
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm" />
      </div>
      {!parentId && (
        <select value={projId ?? ''} onChange={(e) => setProjId(e.target.value ? Number(e.target.value) : null)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm">
          <option value="">{t('Без проекта', 'No project')}</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}
      <div className="flex gap-2">
        <button onClick={() => { if (title.trim()) onSave({ title, description, target_value: Number(targetValue) || 100, unit, due_date: dueDate || null, parent_id: parentId ?? null, project_id: parentId ? (projectId ?? null) : projId, type: parentId ? 'key_result' : 'goal' }); }}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700">{t('Сохранить', 'Save')}</button>
        <button onClick={onCancel} className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-600">{t('Отмена', 'Cancel')}</button>
      </div>
    </div>
  );
}

function KeyResultItem({ kr, onUpdate, onDelete }: { kr: Goal; onUpdate: (id: number, data: Partial<Goal>) => void; onDelete: (id: number) => void }) {
  const { t } = useLangStore();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(kr.current_value));

  return (
    <div className="flex items-start gap-3 py-2 px-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{kr.title}</span>
          {kr.status === 'completed' && <span className="text-xs text-green-600 font-medium">Done</span>}
        </div>
        {kr.description && <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{kr.description}</p>}
        <ProgressBar current={kr.current_value} target={kr.target_value} unit={kr.unit} />
        {editing ? (
          <div className="flex items-center gap-2 mt-1">
            <input type="number" value={val} onChange={(e) => setVal(e.target.value)}
              className="w-20 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-xs" />
            <button onClick={() => { onUpdate(kr.id, { current_value: Number(val) }); setEditing(false); }}
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">OK</button>
            <button onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:underline">{t('Отмена', 'Cancel')}</button>
          </div>
        ) : (
          <div className="flex items-center gap-2 mt-1">
            <button onClick={() => setEditing(true)} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">{t('Обновить прогресс', 'Update progress')}</button>
            <button onClick={() => onDelete(kr.id)} className="text-xs text-red-500 hover:underline">{t('Удалить', 'Delete')}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function GoalCard({ goal, projects, onRefresh }: { goal: Goal; projects: { id: number; name: string; color: string }[]; onRefresh: () => void }) {
  const { t } = useLangStore();
  const [addingKr, setAddingKr] = useState(false);
  const [editingProgress, setEditingProgress] = useState(false);
  const [progressVal, setProgressVal] = useState(String(goal.current_value));
  const project = projects.find((p) => p.id === goal.project_id);

  const krs = goal.key_results ?? [];
  // Auto-calculate progress from KRs if there are any
  const hasKrs = krs.length > 0;
  const autoProgress = hasKrs
    ? Math.round(krs.reduce((sum, kr) => sum + (kr.target_value ? (kr.current_value / kr.target_value) * 100 : 0), 0) / krs.length)
    : null;
  const displayCurrent = autoProgress !== null ? autoProgress : goal.current_value;
  const displayTarget = autoProgress !== null ? 100 : goal.target_value;

  const handleUpdate = async (id: number, data: Partial<Goal>) => {
    await apiPatch(`/goals/${id}`, data);
    onRefresh();
  };

  const handleDelete = async (id: number) => {
    await apiDelete(`/goals/${id}`);
    onRefresh();
  };

  const handleAddKr = async (data: Partial<Goal>) => {
    await apiPost('/goals', data);
    setAddingKr(false);
    onRefresh();
  };

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{goal.title}</h3>
            {goal.status === 'completed' && <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs rounded-full">{t('Выполнено', 'Completed')}</span>}
            {goal.status === 'cancelled' && <span className="px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs rounded-full">{t('Отменено', 'Cancelled')}</span>}
          </div>
          {goal.description && <p className="text-sm text-gray-500 dark:text-gray-400">{goal.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          {project && (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full text-white" style={{ backgroundColor: project.color }}>
              {project.name}
            </span>
          )}
          {goal.due_date && <span className="text-xs text-gray-400">{goal.due_date}</span>}
        </div>
      </div>

      {/* Goal-level progress */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-600 dark:text-gray-300">{t('Прогресс', 'Progress')}</span>
          <span className="text-xl font-bold text-indigo-600 dark:text-indigo-400">
            {displayTarget ? Math.round((displayCurrent / displayTarget) * 100) : 0}%
          </span>
        </div>
        <ProgressBar current={displayCurrent} target={displayTarget} unit={autoProgress !== null ? '%' : goal.unit} />
      </div>

      {/* Direct progress editing (only if no KRs) */}
      {!hasKrs && (
        <div>
          {editingProgress ? (
            <div className="flex items-center gap-2">
              <input type="number" value={progressVal} onChange={(e) => setProgressVal(e.target.value)}
                className="w-24 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm" />
              <button onClick={() => { handleUpdate(goal.id, { current_value: Number(progressVal) }); setEditingProgress(false); }}
                className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">OK</button>
              <button onClick={() => setEditingProgress(false)} className="text-sm text-gray-500 hover:underline">{t('Отмена', 'Cancel')}</button>
            </div>
          ) : (
            <button onClick={() => { setProgressVal(String(goal.current_value)); setEditingProgress(true); }}
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">{t('Обновить прогресс', 'Update progress')}</button>
          )}
        </div>
      )}

      {/* Key Results */}
      {krs.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-gray-600 dark:text-gray-300">{t('Ключевые результаты', 'Key Results')}</h4>
          {krs.map((kr) => (
            <KeyResultItem key={kr.id} kr={kr} onUpdate={handleUpdate} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {/* Add KR */}
      {addingKr ? (
        <AddGoalForm onSave={handleAddKr} onCancel={() => setAddingKr(false)} parentId={goal.id} projectId={goal.project_id} />
      ) : (
        <div className="flex items-center gap-3">
          <button onClick={() => setAddingKr(true)}
            className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">+ {t('Добавить KR', 'Add KR')}</button>
          <button onClick={() => handleDelete(goal.id)}
            className="text-sm text-red-500 hover:underline">{t('Удалить цель', 'Delete goal')}</button>
          {goal.status === 'active' && (
            <button onClick={() => handleUpdate(goal.id, { status: 'completed' })}
              className="text-sm text-green-600 dark:text-green-400 hover:underline">{t('Завершить', 'Complete')}</button>
          )}
        </div>
      )}
    </div>
  );
}

export function GoalsPage() {
  const { t } = useLangStore();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'list' | 'mindmap'>('mindmap');
  const [showCreateBhag, setShowCreateBhag] = useState(false);
  const { projects, fetchProjects } = useProjectsStore();

  const load = useCallback(async () => {
    try {
      const data = await apiGet<Goal[]>('/goals');
      setGoals(data);
    } catch (e) {
      console.error('Failed to load goals', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    fetchProjects();
  }, [load, fetchProjects]);

  const handleAddGoal = async (data: Partial<Goal>) => {
    await apiPost('/goals', data);
    setAdding(false);
    load();
  };

  const bhags = goals.filter((g) => g.type === 'bhag');
  const activeGoals = goals.filter((g) => g.status === 'active');
  const completedGoals = goals.filter((g) => g.status !== 'active');

  return (
    <div className="relative overflow-hidden p-4 md:p-6 max-w-4xl mx-auto">
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full bg-indigo-400/15 dark:bg-white/[0.07]" style={{ animation: 'circleLeft 30s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute -top-20 -right-20 w-[350px] h-[350px] rounded-full bg-purple-400/12 dark:bg-white/[0.05]" style={{ animation: 'circleLeftSlow 26s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] h-[500px] rounded-full bg-indigo-400/[0.14] dark:bg-white/[0.06] blur-[80px]" style={{ animation: 'circleRight 34s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="relative z-10 flex items-center justify-between mb-6">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-rose-500 to-rose-600 flex items-center justify-center shadow-lg shadow-rose-500/25">
            <Target size={20} className="text-white" />
          </div>
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('Цели', 'Goals')}</h1>
          <div className="flex gap-2 ml-4">
            <button
              onClick={() => setActiveTab('list')}
              className={`px-3 py-1 rounded-lg text-sm ${activeTab === 'list' ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
            >
              {t('Список', 'List')}
            </button>
            <button
              onClick={() => setActiveTab('mindmap')}
              className={`px-3 py-1 rounded-lg text-sm ${activeTab === 'mindmap' ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
            >
              Mind Map
            </button>
          </div>
        </div>
        <button onClick={() => setAdding(true)}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
          + {t('Добавить цель', 'Add goal')}
        </button>
      </div>

      {adding && (
        <div className="mb-6">
          <AddGoalForm onSave={handleAddGoal} onCancel={() => setAdding(false)} />
        </div>
      )}

      {activeTab === 'list' ? (
        <>
          {loading ? (
            <div className="text-center text-gray-400 py-12">{t('Загрузка...', 'Loading...')}</div>
          ) : goals.length === 0 && !adding ? (
            <div className="text-center py-16">
              <div className="text-5xl mb-4">🎯</div>
              <p className="text-gray-500 dark:text-gray-400 text-lg mb-2">{t('Пока нет целей', 'No goals yet')}</p>
              <p className="text-gray-400 dark:text-gray-500 text-sm">{t('Добавьте первую цель и ключевые результаты', 'Add your first goal and key results')}</p>
            </div>
          ) : (
            <div className="space-y-8">
              {activeGoals.length > 0 && (
                <div className="space-y-4">
                  {activeGoals.map((g) => (
                    <GoalCard key={g.id} goal={g} projects={projects} onRefresh={load} />
                  ))}
                </div>
              )}

              {completedGoals.length > 0 && (
                <div>
                  <h2 className="text-lg font-semibold text-gray-500 dark:text-gray-400 mb-3">{t('Завершённые', 'Completed')}</h2>
                  <div className="space-y-4 opacity-60">
                    {completedGoals.map((g) => (
                      <GoalCard key={g.id} goal={g} projects={projects} onRefresh={load} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <MindMapTab
          bhagId={bhags[0]?.id ?? null}
          bhags={bhags.map(b => ({ id: b.id, title: b.title }))}
          onCreateBhag={() => setShowCreateBhag(true)}
        />
      )}

      <DecomposeModal
        open={showCreateBhag}
        onClose={() => setShowCreateBhag(false)}
        onCreated={() => { load(); setActiveTab('mindmap'); setShowCreateBhag(false); }}
      />
    </div>
  );
}
