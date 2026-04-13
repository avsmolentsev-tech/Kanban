import { useState, useEffect } from 'react';
import { SlidePanel } from '../ui/SlidePanel';
import type { Project, Person, TaskStatus } from '@pis/shared';
import { tasksApi } from '../../api/tasks.api';
import { useLangStore } from '../../store/lang.store';

export type CreatePeriod = 'backlog' | 'today' | 'tomorrow' | 'week' | 'month' | 'year' | 'someday' | 'none';

interface Props {
  open: boolean;
  projects: Project[];
  people: Person[];
  initialProjectId?: number | null;
  initialPeriod?: CreatePeriod;
  onClose: () => void;
  onCreated: () => void;
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function periodToDate(period: CreatePeriod): string {
  const now = new Date();
  switch (period) {
    case 'today': return localDateStr(now);
    case 'tomorrow': { const d = new Date(now); d.setDate(now.getDate() + 1); return localDateStr(d); }
    case 'week': { const d = new Date(now); d.setDate(now.getDate() + (5 - now.getDay())); return localDateStr(d); }
    case 'month': { const d = new Date(now.getFullYear(), now.getMonth() + 1, 0); return localDateStr(d); }
    case 'year': return `${now.getFullYear()}-12-31`;
    default: return '';
  }
}

function periodToStatus(period: CreatePeriod): TaskStatus {
  if (period === 'backlog') return 'backlog';
  if (period === 'someday') return 'someday';
  return 'todo';
}

export function TaskCreatePanel({ open, projects, people, initialProjectId, initialPeriod, onClose, onCreated }: Props) {
  const { t } = useLangStore();

  const PERIOD_OPTIONS: { value: CreatePeriod; label: string }[] = [
    { value: 'today', label: t('Сегодня', 'Today') },
    { value: 'tomorrow', label: t('Завтра', 'Tomorrow') },
    { value: 'week', label: t('На неделе', 'This week') },
    { value: 'month', label: t('В этом месяце', 'This month') },
    { value: 'year', label: t('В этом году', 'This year') },
    { value: 'backlog', label: t('Бэклог', 'Backlog') },
    { value: 'someday', label: t('Когда-нибудь', 'Someday') },
    { value: 'none', label: t('Без даты', 'No date') },
  ];

  const RECURRENCE_OPTIONS: { value: string | null; label: string }[] = [
    { value: null, label: t('Нет', 'None') },
    { value: 'daily', label: t('Ежедневно', 'Daily') },
    { value: 'weekly', label: t('Еженедельно', 'Weekly') },
    { value: 'monthly', label: t('Ежемесячно', 'Monthly') },
  ];

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [period, setPeriod] = useState<CreatePeriod>(initialPeriod ?? 'today');
  const [dueDate, setDueDate] = useState<string>(periodToDate(initialPeriod ?? 'today'));
  const [projectId, setProjectId] = useState<number | null>(initialProjectId ?? null);
  const [priority, setPriority] = useState(3);
  const [urgency, setUrgency] = useState(3);
  const [recurrence, setRecurrence] = useState<string | null>(null);
  const [assignedIds, setAssignedIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      const p = initialPeriod ?? 'today';
      setPeriod(p);
      setDueDate(periodToDate(p));
      setProjectId(initialProjectId ?? null);
      setPriority(3);
      setUrgency(3);
      setRecurrence(null);
      setAssignedIds([]);
    }
  }, [open, initialPeriod, initialProjectId]);

  const selectPeriod = (p: CreatePeriod) => {
    setPeriod(p);
    setDueDate(periodToDate(p));
  };

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await tasksApi.create({
        title: title.trim(),
        description: description.trim() || undefined,
        status: periodToStatus(period),
        priority,
        urgency,
        due_date: dueDate || undefined,
        project_id: projectId ?? undefined,
        person_ids: assignedIds,
        recurrence: recurrence ?? undefined,
      } as Parameters<typeof tasksApi.create>[0]);
      onCreated();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const togglePerson = (id: number) => {
    setAssignedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const activeProjects = projects.filter((p) => !p.archived);
  const assignedSet = new Set(assignedIds);

  return (
    <SlidePanel open={open} onClose={onClose} title={t('Новая задача', 'New task')}>
      <div className="space-y-4">
        <input
          autoFocus
          className="w-full text-lg font-semibold bg-transparent text-gray-800 dark:text-gray-100 border-b border-gray-200 dark:border-gray-600 focus:border-indigo-400 focus:outline-none px-1 py-0.5"
          placeholder={t('Название задачи...', 'Task title...')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) submit(); }}
          disabled={saving}
        />

        {/* Period */}
        <div>
          <div className="text-xs text-gray-500 mb-1">{t('Когда', 'When')}</div>
          <div className="flex flex-wrap gap-1.5">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                disabled={saving}
                onClick={() => selectPeriod(opt.value)}
                className={`px-2.5 py-1 text-xs rounded border transition-colors ${period === opt.value ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-indigo-300'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Project */}
        <div>
          <div className="text-xs text-gray-500 mb-1">{t('Проект', 'Project')}</div>
          <select
            className="w-full text-sm border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300"
            value={projectId ?? ''}
            onChange={(e) => setProjectId(e.target.value === '' ? null : Number(e.target.value))}
            disabled={saving}
          >
            <option value="">{t('Без проекта', 'No project')}</option>
            {activeProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Priority & Urgency */}
        <div className="grid grid-cols-2 gap-3">
          <RatingField label={t('Приоритет', 'Priority')} value={priority} onChange={setPriority} disabled={saving} />
          <RatingField label={t('Срочность', 'Urgency')} value={urgency} onChange={setUrgency} disabled={saving} />
        </div>

        {/* Exact date */}
        <div>
          <div className="text-xs text-gray-500 mb-1">{t('Дедлайн', 'Deadline')}</div>
          <input
            type="date"
            className="w-full text-sm border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
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
                onClick={() => setRecurrence(opt.value)}
                className={`px-2.5 py-1 text-xs rounded border transition-colors ${recurrence === opt.value ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-indigo-300'}`}
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
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={saving}
          />
        </div>

        {/* Assignees */}
        {people.length > 0 && (
          <div>
            <div className="text-xs text-gray-500 mb-2">{t('Исполнители', 'Assignees')}</div>
            <div className="flex flex-wrap gap-2">
              {people.map((p) => {
                const assigned = assignedSet.has(p.id);
                return (
                  <button key={p.id} type="button" onClick={() => togglePerson(p.id)} disabled={saving}
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

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
          <button onClick={onClose} disabled={saving}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-3 py-1.5">
            {t('Отмена', 'Cancel')}
          </button>
          <button onClick={submit} disabled={!title.trim() || saving}
            className="text-sm bg-indigo-600 text-white px-4 py-1.5 rounded hover:bg-indigo-700 disabled:opacity-50">
            {saving ? '...' : t('Создать', 'Create')}
          </button>
        </div>
      </div>
    </SlidePanel>
  );
}

function RatingField({ label, value, onChange, disabled }: { label: string; value: number; onChange: (n: number) => void; disabled?: boolean }) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" disabled={disabled} onClick={() => onChange(n)}
            className={`w-7 h-7 text-xs rounded border transition-colors ${n <= value ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-gray-700 text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-600 hover:border-indigo-300'}`}>
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
