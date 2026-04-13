import { useState, useEffect } from 'react';
import { SlidePanel } from '../ui/SlidePanel';
import type { Task, Project, Person, TaskStatus } from '@pis/shared';
import { tasksApi } from '../../api/tasks.api';
import { apiGet, apiPost, apiDelete } from '../../api/client';
import { useLangStore } from '../../store/lang.store';

interface Tag {
  id: number;
  name: string;
  color: string;
}

interface Props {
  task: Task | null;
  projects: Project[];
  people: Person[];
  onClose: () => void;
  onUpdated: () => void;
  onDeleted?: () => void;
}

type FormState = {
  title: string;
  description: string;
  status: TaskStatus;
  priority: number;
  urgency: number;
  due_date: string;
  project_id: number | null;
  recurrence: string | null;
};

export function TaskDetailPanel({ task, projects, people, onClose, onUpdated, onDeleted }: Props) {
  const { t } = useLangStore();

  const RECURRENCE_OPTIONS: { value: string | null; label: string }[] = [
    { value: null, label: t('Нет', 'None') },
    { value: 'daily', label: t('Ежедневно', 'Daily') },
    { value: 'weekly', label: t('Еженедельно', 'Weekly') },
    { value: 'monthly', label: t('Ежемесячно', 'Monthly') },
  ];

  type Period = 'today' | 'tomorrow' | 'week' | 'month' | 'year' | 'backlog' | 'someday' | 'none' | 'in_progress' | 'done';

  const PERIOD_OPTIONS: { value: Period; label: string }[] = [
    { value: 'today', label: t('Сегодня', 'Today') },
    { value: 'tomorrow', label: t('Завтра', 'Tomorrow') },
    { value: 'week', label: t('На неделе', 'This week') },
    { value: 'month', label: t('В этом месяце', 'This month') },
    { value: 'year', label: t('В этом году', 'This year') },
    { value: 'none', label: t('Без даты', 'No date') },
    { value: 'backlog', label: t('Бэклог', 'Backlog') },
    { value: 'in_progress', label: t('В работе', 'In progress') },
    { value: 'done', label: t('Готово', 'Done') },
    { value: 'someday', label: t('Когда-нибудь', 'Someday') },
  ];

  const localDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const periodToUpdates = (p: Period): { status: TaskStatus; due_date: string | null } | { status: TaskStatus } => {
    const now = new Date();
    switch (p) {
      case 'today': return { status: 'todo', due_date: localDateStr(now) };
      case 'tomorrow': { const d = new Date(now); d.setDate(now.getDate() + 1); return { status: 'todo', due_date: localDateStr(d) }; }
      case 'week': { const d = new Date(now); d.setDate(now.getDate() + (5 - now.getDay())); return { status: 'todo', due_date: localDateStr(d) }; }
      case 'month': { const d = new Date(now.getFullYear(), now.getMonth() + 1, 0); return { status: 'todo', due_date: localDateStr(d) }; }
      case 'year': return { status: 'todo', due_date: `${now.getFullYear()}-12-31` };
      case 'none': return { status: 'todo', due_date: null };
      case 'backlog': return { status: 'backlog', due_date: null };
      case 'someday': return { status: 'someday', due_date: null };
      case 'in_progress': return { status: 'in_progress' };
      case 'done': return { status: 'done' };
    }
  };

  const currentPeriod = (status: TaskStatus, dueDate: string | null): Period => {
    if (status === 'in_progress') return 'in_progress';
    if (status === 'done') return 'done';
    if (status === 'backlog') return 'backlog';
    if (status === 'someday') return 'someday';
    if (!dueDate) return 'none';
    const due = new Date(dueDate);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const dayAfter = new Date(today); dayAfter.setDate(today.getDate() + 2);
    if (due < tomorrow) return 'today';
    if (due < dayAfter) return 'tomorrow';
    const weekEnd = new Date(today); weekEnd.setDate(today.getDate() + 7);
    if (due < weekEnd) return 'week';
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    if (due <= monthEnd) return 'month';
    return 'year';
  };

  const [form, setForm] = useState<FormState>({
    title: '',
    description: '',
    status: 'backlog',
    priority: 3,
    urgency: 3,
    due_date: '',
    project_id: null,
    recurrence: null,
  });
  const [saving, setSaving] = useState(false);
  const [assignedIdsLocal, setAssignedIdsLocal] = useState<number[]>([]);
  const [comments, setComments] = useState<Array<{id: number; text: string; created_at: string}>>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [taskTags, setTaskTags] = useState<Tag[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [dependencies, setDependencies] = useState<Array<{id: number; title: string; status: string; priority: number}>>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [depSelectOpen, setDepSelectOpen] = useState(false);

  useEffect(() => {
    if (task) {
      setForm({
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        urgency: task.urgency,
        due_date: task.due_date ?? '',
        project_id: task.project_id,
        recurrence: (task as unknown as Record<string, unknown>)['recurrence'] as string | null ?? null,
      });
      setAssignedIdsLocal((task.people ?? []).map((p) => p.id));
      apiGet<Array<{id: number; text: string; created_at: string}>>(`/tasks/${task.id}/comments`).then(setComments).catch(() => {});
      setCommentText('');
      setTaskTags((task.tags ?? []) as Tag[]);
      apiGet<Tag[]>('/tags').then(setAllTags).catch(() => {});
      apiGet<Array<{id: number; title: string; status: string; priority: number}>>(`/tasks/${task.id}/dependencies`).then(setDependencies).catch(() => setDependencies([]));
      apiGet<Task[]>('/tasks').then(setAllTasks).catch(() => setAllTasks([]));
    }
  }, [task]);

  const addComment = async () => {
    if (!task || !commentText.trim()) return;
    const comment = await apiPost<{id: number; text: string; created_at: string}>(`/tasks/${task.id}/comments`, { text: commentText.trim() });
    setComments((prev) => [comment, ...prev]);
    setCommentText('');
  };

  const deleteComment = async (commentId: number) => {
    if (!task) return;
    await apiDelete(`/tasks/${task.id}/comments/${commentId}`);
    setComments((prev) => prev.filter((c) => c.id !== commentId));
  };

  const assignedIds = new Set(assignedIdsLocal);

  const save = async (updates: Partial<FormState>) => {
    if (!task) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { ...updates };
      if ('due_date' in updates) {
        payload.due_date = updates.due_date === '' ? null : updates.due_date;
      }
      await tasksApi.update(task.id, payload);
      onUpdated();
    } finally {
      setSaving(false);
    }
  };

  const handleBlur = (field: keyof FormState) => {
    if (!task) return;
    const newVal = form[field];
    const oldVal: unknown = field === 'due_date' ? (task.due_date ?? '') : (task as unknown as Record<string, unknown>)[field];
    if (newVal !== oldVal) save({ [field]: newVal });
  };

  const handleSelectChange = (field: keyof FormState, value: string | number | null) => {
    setForm((f) => ({ ...f, [field]: value }));
    save({ [field]: value });
  };

  const handleRatingClick = (field: 'priority' | 'urgency', value: number) => {
    setForm((f) => ({ ...f, [field]: value }));
    save({ [field]: value });
  };

  const togglePerson = async (personId: number) => {
    if (!task) return;
    const next = assignedIds.has(personId)
      ? assignedIdsLocal.filter((id) => id !== personId)
      : [...assignedIdsLocal, personId];
    setAssignedIdsLocal(next); // instant UI update
    setSaving(true);
    try {
      await tasksApi.update(task.id, { person_ids: next });
      onUpdated();
    } catch (err) {
      setAssignedIdsLocal(assignedIdsLocal); // revert on error
      alert(t('Ошибка: ', 'Error: ') + (err instanceof Error ? err.message : 'unknown'));
    } finally {
      setSaving(false);
    }
  };

  const activeProjects = projects.filter((p) => !p.archived);

  return (
    <SlidePanel open={!!task} onClose={onClose} title="">
      {task && (
        <div className="space-y-4">
          {/* Title */}
          <input
            className="w-full text-lg font-semibold bg-transparent text-gray-800 dark:text-gray-100 border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-indigo-400 focus:outline-none px-1 py-0.5"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            onBlur={() => handleBlur('title')}
            disabled={saving}
          />

          {/* Period (replaces status + deadline) */}
          <div>
            <div className="text-xs text-gray-500 mb-1">{t('Когда', 'When')}</div>
            <div className="flex flex-wrap gap-1.5">
              {PERIOD_OPTIONS.map((opt) => {
                const active = currentPeriod(form.status, form.due_date || null) === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      const updates = periodToUpdates(opt.value);
                      setForm((f) => ({ ...f, status: updates.status, due_date: 'due_date' in updates ? (updates.due_date ?? '') : f.due_date }));
                      save(updates as Partial<FormState>);
                    }}
                    className={`px-2.5 py-1 text-xs rounded border transition-colors ${active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-indigo-300'}`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Project */}
          <div>
            <div className="text-xs text-gray-500 mb-1">{t('Проект', 'Project')}</div>
            <select
              className="w-full text-sm border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300"
              value={form.project_id ?? ''}
              onChange={(e) => handleSelectChange('project_id', e.target.value === '' ? null : Number(e.target.value))}
              disabled={saving}
            >
              <option value="">{t('Без проекта', 'No project')}</option>
              {activeProjects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Tags */}
          <div>
            <div className="text-xs text-gray-500 mb-1">{t('Метки', 'Tags')}</div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {taskTags.map((tag) => (
                <span key={tag.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-white"
                  style={{ backgroundColor: tag.color }}>
                  {tag.name}
                  <button onClick={async () => {
                    await apiDelete(`/tags/tasks/${task.id}/tags/${tag.id}`);
                    setTaskTags((prev) => prev.filter((t) => t.id !== tag.id));
                    onUpdated();
                  }} className="hover:opacity-70 text-white/80 ml-0.5">&times;</button>
                </span>
              ))}
            </div>
            {/* Existing tags to attach */}
            {allTags.filter((t) => !taskTags.some((tt) => tt.id === t.id)).length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {allTags.filter((t) => !taskTags.some((tt) => tt.id === t.id)).map((tag) => (
                  <button key={tag.id} onClick={async () => {
                    await apiPost(`/tags/tasks/${task.id}/tags/${tag.id}`);
                    setTaskTags((prev) => [...prev, tag]);
                    onUpdated();
                  }} className="px-2 py-0.5 rounded-full text-xs border border-gray-200 dark:border-gray-600 hover:border-indigo-300 text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700"
                    style={{ borderColor: tag.color, color: tag.color }}>
                    + {tag.name}
                  </button>
                ))}
              </div>
            )}
            {/* Create new tag */}
            {showTagInput ? (
              <div className="flex gap-1.5">
                <input autoFocus className="flex-1 text-xs border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded px-2 py-1 focus:outline-none focus:border-indigo-300"
                  placeholder={t('Название метки', 'Tag name')} value={newTagName} onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter' && newTagName.trim()) {
                      const tag = await apiPost<Tag>('/tags', { name: newTagName.trim() });
                      await apiPost(`/tags/tasks/${task.id}/tags/${tag.id}`);
                      setTaskTags((prev) => [...prev, tag]);
                      setAllTags((prev) => [...prev, tag]);
                      setNewTagName('');
                      setShowTagInput(false);
                      onUpdated();
                    }
                    if (e.key === 'Escape') { setShowTagInput(false); setNewTagName(''); }
                  }} />
                <button onClick={() => { setShowTagInput(false); setNewTagName(''); }} className="text-xs text-gray-400 hover:text-gray-600">{t('Отмена', 'Cancel')}</button>
              </div>
            ) : (
              <button onClick={() => setShowTagInput(true)} className="text-xs text-indigo-500 hover:text-indigo-700">+ {t('Новая метка', 'New tag')}</button>
            )}
          </div>

          {/* Dependencies */}
          <div>
            <div className="text-xs text-gray-500 mb-1">{t('Зависимости', 'Dependencies')}</div>
            {dependencies.some(d => d.status !== 'done') && (
              <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/30 rounded px-2 py-1 mb-2 font-medium">
                ⚠️ {t('Заблокировано', 'Blocked')}
              </div>
            )}
            {dependencies.map(dep => (
              <div key={dep.id} className="flex items-center justify-between py-1 group">
                <div className="flex items-center gap-2 text-sm">
                  <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-[10px] ${dep.status === 'done' ? 'bg-green-500 border-green-500 text-white' : dep.status === 'in_progress' ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-300 dark:border-gray-600 text-gray-400'}`}>
                    {dep.status === 'done' ? '✓' : dep.status === 'in_progress' ? '►' : '○'}
                  </span>
                  <span className={dep.status === 'done' ? 'line-through text-gray-400' : 'text-gray-700 dark:text-gray-200'}>{dep.title}</span>
                </div>
                <button
                  onClick={async () => {
                    await apiDelete(`/tasks/${task.id}/dependencies/${dep.id}`);
                    setDependencies(prev => prev.filter(d => d.id !== dep.id));
                    onUpdated();
                  }}
                  className="text-[10px] text-red-400 opacity-0 group-hover:opacity-100 hover:text-red-600"
                >
                  {t('убрать', 'remove')}
                </button>
              </div>
            ))}
            {depSelectOpen ? (
              <div className="mt-1">
                <select
                  autoFocus
                  className="w-full text-sm border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300"
                  value=""
                  onChange={async (e) => {
                    const depId = Number(e.target.value);
                    if (!depId) return;
                    await apiPost(`/tasks/${task.id}/dependencies`, { depends_on_id: depId });
                    const depTask = allTasks.find(t => t.id === depId);
                    if (depTask) {
                      setDependencies(prev => [...prev, { id: depTask.id, title: depTask.title, status: depTask.status, priority: depTask.priority }]);
                    }
                    setDepSelectOpen(false);
                    onUpdated();
                  }}
                  onBlur={() => setDepSelectOpen(false)}
                >
                  <option value="">{t('Выберите задачу...', 'Select a task...')}</option>
                  {allTasks
                    .filter(t => t.id !== task.id && !dependencies.some(d => d.id === t.id))
                    .map(t => (
                      <option key={t.id} value={t.id}>{t.title}</option>
                    ))}
                </select>
              </div>
            ) : (
              <button onClick={() => setDepSelectOpen(true)} className="text-xs text-indigo-500 hover:text-indigo-700 mt-1">
                + {t('Добавить зависимость', 'Add dependency')}
              </button>
            )}
          </div>

          {/* Priority & Urgency */}
          <div className="grid grid-cols-2 gap-3">
            <RatingField
              label={t('Приоритет', 'Priority')}
              value={form.priority}
              onChange={(v) => handleRatingClick('priority', v)}
              disabled={saving}
            />
            <RatingField
              label={t('Срочность', 'Urgency')}
              value={form.urgency}
              onChange={(v) => handleRatingClick('urgency', v)}
              disabled={saving}
            />
          </div>

          {/* Recurrence */}
          <div>
            <div className="text-xs text-gray-500 mb-1">{t('Повторение', 'Recurrence')}</div>
            <div className="flex gap-1">
              {RECURRENCE_OPTIONS.map((opt) => (
                <button
                  key={opt.value ?? 'none'}
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setForm((f) => ({ ...f, recurrence: opt.value }));
                    save({ recurrence: opt.value } as Partial<FormState>);
                  }}
                  className={`px-2.5 py-1 text-xs rounded border transition-colors ${form.recurrence === opt.value ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-indigo-300'}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <div className="text-xs text-gray-500 mb-1">{t('Описание', 'Description')}</div>
            <textarea
              className="w-full text-sm border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300 resize-none"
              rows={4}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              onBlur={() => handleBlur('description')}
              disabled={saving}
            />
          </div>

          {/* Assignees */}
          {people.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-2">{t('Исполнители', 'Assignees')}</div>
              <div className="flex flex-wrap gap-2">
                {people.map((p) => {
                  const assigned = assignedIds.has(p.id);
                  return (
                    <button key={p.id} onClick={() => togglePerson(p.id)} disabled={saving}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs border transition-colors ${assigned ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-indigo-400'}`}>
                      <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${assigned ? 'bg-indigo-400' : 'bg-gray-200 dark:bg-gray-600 dark:text-gray-200'}`}>
                        {p.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)}
                      </span>
                      {p.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Comments */}
          <div>
            <div className="text-xs text-gray-500 mb-2">{t('Комментарии', 'Comments')}</div>
            {comments.map(c => (
              <div key={c.id} className="text-sm bg-gray-50 dark:bg-gray-900 rounded-lg p-2 mb-1.5 group">
                <div className="text-gray-700 dark:text-gray-200">{c.text}</div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-gray-400">{c.created_at.split('T')[0]}</span>
                  <button onClick={() => deleteComment(c.id)} className="text-[10px] text-red-400 opacity-0 group-hover:opacity-100">{t('удалить', 'delete')}</button>
                </div>
              </div>
            ))}
            <div className="flex gap-2 mt-2">
              <input className="flex-1 text-sm border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300 bg-white dark:bg-gray-700"
                placeholder={t('Комментарий...', 'Comment...')} value={commentText} onChange={e => setCommentText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && commentText.trim()) addComment(); }} />
              <button onClick={addComment} disabled={!commentText.trim()} className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded hover:bg-indigo-700 disabled:opacity-50">→</button>
            </div>
          </div>

          {/* Subtasks */}
          <div>
            <div className="text-xs text-gray-500 mb-2">{t('Подзадачи', 'Subtasks')}</div>
            {((task as unknown as Record<string, unknown>)['subtasks'] as Array<{ id: number; title: string; status: string }> ?? []).map(sub => (
              <div key={sub.id} className="flex items-center gap-2 py-1">
                <button
                  onClick={async () => {
                    const next = sub.status === 'done' ? 'todo' : 'done';
                    await tasksApi.update(sub.id, { status: next });
                    onUpdated();
                  }}
                  className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-[10px] ${sub.status === 'done' ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 dark:border-gray-600'}`}
                >
                  {sub.status === 'done' ? '✓' : ''}
                </button>
                <span className={`text-sm ${sub.status === 'done' ? 'line-through text-gray-400' : 'text-gray-700'}`}>{sub.title}</span>
              </div>
            ))}
            <SubtaskInput taskId={task.id} projectId={task.project_id} onCreated={onUpdated} />
          </div>

          <div className="text-xs text-gray-400 pt-2">{t('Создано: ', 'Created: ')}{task.created_at}</div>

          {onDeleted && (
            <button
              onClick={async () => {
                if (confirm(t('Удалить задачу?', 'Delete task?'))) {
                  await tasksApi.delete(task.id);
                  onDeleted();
                  onClose();
                }
              }}
              className="w-full py-2 text-sm text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg border border-red-200 transition-colors"
            >
              {t('Удалить задачу', 'Delete task')}
            </button>
          )}
        </div>
      )}
    </SlidePanel>
  );
}

function SubtaskInput({ taskId, projectId, onCreated }: { taskId: number; projectId: number | null; onCreated: () => void }) {
  const { t } = useLangStore();
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await tasksApi.create({ title: title.trim(), parent_id: taskId, project_id: projectId ?? undefined, status: 'todo', priority: 3 });
      setTitle('');
      onCreated();
    } catch (err) {
      alert(t('Ошибка: ', 'Error: ') + (err instanceof Error ? err.message : 'unknown'));
    } finally {
      setSaving(false);
    }
  };

  if (!adding) {
    return (
      <button onClick={() => setAdding(true)} className="text-xs text-indigo-500 hover:text-indigo-700 mt-1">
        + {t('Подзадача', 'Subtask')}
      </button>
    );
  }

  return (
    <div className="flex gap-2 mt-1">
      <input
        autoFocus
        className="flex-1 text-sm border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded px-2 py-1 focus:outline-none focus:border-indigo-300"
        placeholder={t('Название подзадачи', 'Subtask title')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setAdding(false); }}
      />
      <button onClick={submit} disabled={!title.trim()} className="text-xs bg-indigo-600 text-white px-2 py-1 rounded hover:bg-indigo-700 disabled:opacity-50">+</button>
    </div>
  );
}

function RatingField({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled: boolean }) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onClick={() => onChange(n)}
            className={`w-7 h-7 text-xs rounded border transition-colors ${n <= value ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-gray-700 text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-600 hover:border-indigo-300'}`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
