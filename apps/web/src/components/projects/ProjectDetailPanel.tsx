import { useState, useEffect } from 'react';
import { SlidePanel } from '../ui/SlidePanel';
import { projectsApi } from '../../api/projects.api';
import { apiGet } from '../../api/client';
import type { Project, ProjectStatus } from '@pis/shared';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];
const STATUSES: ProjectStatus[] = ['active', 'completed', 'archived'];
const STATUS_LABELS: Record<string, string> = { active: '🚀 Активный', completed: '🔄 В работе', archived: '✅ Завершён' };

interface ProjectDetail {
  tasks: Array<{ id: number; title: string; status: string; priority: number }>;
  meetings: Array<{ id: number; title: string; date: string }>;
}

interface Props {
  project: Project | null;
  onClose: () => void;
  onUpdated: () => void;
  onDeleted?: () => void;
}

export function ProjectDetailPanel({ project, onClose, onUpdated, onDeleted }: Props) {
  const [form, setForm] = useState<Partial<Project>>({});
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [people, setPeople] = useState<Array<{ id: number; name: string }>>([]);

  useEffect(() => {
    if (project) {
      setForm({ ...project });
      // Fetch project details
      projectsApi.get(project.id).then((d) => {
        setDetail(d as unknown as ProjectDetail);
      }).catch(() => {});
      // Fetch people linked to this project
      apiGet<Array<{ id: number; name: string; project_ids?: number[] }>>('/people').then(allPeople => {
        const linked = allPeople.filter(p => p.project_ids?.includes(project.id));
        setPeople(linked);
      }).catch(() => {});
    }
  }, [project]);

  const save = async (field: string, value: string | boolean | null) => {
    if (!project) return;
    await projectsApi.update(project.id, { [field]: value });
    onUpdated();
  };

  const handleChange = (field: keyof Project, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  const handleBlur = (field: string) => {
    if (!project) return;
    const newVal = (form as unknown as Record<string, unknown>)[field];
    const oldVal = (project as unknown as Record<string, unknown>)[field];
    if (newVal !== oldVal) save(field, newVal as string);
  };

  const handleColorChange = (color: string) => {
    setForm((f) => ({ ...f, color }));
    save('color', color);
  };

  const tasksByStatus = { backlog: 0, todo: 0, in_progress: 0, done: 0, someday: 0 };
  for (const t of detail?.tasks ?? []) {
    if (t.status in tasksByStatus) tasksByStatus[t.status as keyof typeof tasksByStatus]++;
  }
  const totalTasks = detail?.tasks?.length ?? 0;
  const doneTasks = tasksByStatus.done;
  const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  return (
    <SlidePanel open={!!project} onClose={onClose} title={project?.name ?? ''} expandable>
      {project && (
        <div className="space-y-4">
          {/* Name */}
          <div className="flex items-center gap-2">
            <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: form.color ?? project.color }} />
            <input
              className="flex-1 text-lg font-semibold border-b border-transparent hover:border-gray-300 focus:border-indigo-400 focus:outline-none px-1 py-0.5"
              value={form.name ?? ''}
              onChange={(e) => handleChange('name', e.target.value)}
              onBlur={() => handleBlur('name')}
            />
          </div>

          {/* Description */}
          <div>
            <div className="text-xs text-gray-500 mb-1">Описание</div>
            <textarea className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300 resize-none"
              rows={2} value={form.description ?? ''} onChange={(e) => handleChange('description', e.target.value)} onBlur={() => handleBlur('description')} />
          </div>

          {/* Status chips */}
          <div>
            <div className="text-xs text-gray-500 mb-1.5">Стадия</div>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((s) => (
                <button key={s} type="button"
                  onClick={() => { setForm(f => ({ ...f, status: s })); save('status', s); }}
                  className={`text-xs px-3 py-1 rounded-full border transition-colors ${form.status === s ? 'bg-indigo-600 text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Color */}
          <div>
            <div className="text-xs text-gray-500 mb-1.5">Цвет</div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {COLORS.map((c) => (
                <button key={c} type="button" onClick={() => handleColorChange(c)}
                  className={`w-6 h-6 rounded-full border-2 transition-all ${form.color === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>

          {/* Progress */}
          {totalTasks > 0 && (
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-500">Прогресс задач</span>
                <span className="text-xs font-bold text-gray-700 dark:text-gray-200">{progress}%</span>
              </div>
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mb-2">
                <div className="h-full rounded-full" style={{ width: `${progress}%`, backgroundColor: project.color }} />
              </div>
              <div className="flex gap-3 text-[10px] text-gray-400">
                <span>📥 {tasksByStatus.backlog} бэклог</span>
                <span>📋 {tasksByStatus.todo} todo</span>
                <span>🔄 {tasksByStatus.in_progress} в работе</span>
                <span>✅ {tasksByStatus.done} готово</span>
              </div>
            </div>
          )}

          {/* Meetings */}
          {detail?.meetings && detail.meetings.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-2">🤝 Встречи ({detail.meetings.length})</div>
              <div className="space-y-1 max-h-32 overflow-auto">
                {detail.meetings.map(m => (
                  <div key={m.id} className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-2 py-1">
                    <span className="text-gray-400">{m.date}</span>
                    <span className="truncate">{m.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* People */}
          {people.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-2">👥 Люди ({people.length})</div>
              <div className="flex flex-wrap gap-1.5">
                {people.map(p => (
                  <span key={p.id} className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded-full text-gray-600 dark:text-gray-300">
                    {p.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Tasks list */}
          {detail?.tasks && detail.tasks.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-2">📋 Задачи ({detail.tasks.length})</div>
              <div className="space-y-1 max-h-40 overflow-auto">
                {detail.tasks.slice(0, 15).map(t => (
                  <div key={t.id} className={`text-xs flex items-center gap-2 py-0.5 ${t.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-600 dark:text-gray-300'}`}>
                    <span>{t.status === 'done' ? '✅' : t.status === 'in_progress' ? '🔄' : '📋'}</span>
                    <span className="truncate">{t.title}</span>
                    <span className="ml-auto text-gray-300">{'⭐'.repeat(t.priority)}</span>
                  </div>
                ))}
                {detail.tasks.length > 15 && <div className="text-[10px] text-gray-400">+{detail.tasks.length - 15} ещё</div>}
              </div>
            </div>
          )}

          <div className="text-xs text-gray-400 pt-2">Создано: {project.created_at}</div>

          {onDeleted && (
            <button onClick={async () => { if (confirm(`Удалить проект "${project.name}"?`)) { await projectsApi.delete(project.id); onDeleted(); onClose(); } }}
              className="w-full py-2 text-sm text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg border border-red-200 transition-colors">
              Удалить проект
            </button>
          )}
        </div>
      )}
    </SlidePanel>
  );
}
