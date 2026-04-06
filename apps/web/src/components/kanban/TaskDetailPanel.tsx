import { useState, useEffect } from 'react';
import { SlidePanel } from '../ui/SlidePanel';
import type { Task, Project, Person, TaskStatus } from '@pis/shared';
import { tasksApi } from '../../api/tasks.api';

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
  { value: 'someday', label: 'Когда-нибудь' },
];

interface Props {
  task: Task | null;
  projects: Project[];
  people: Person[];
  onClose: () => void;
  onUpdated: () => void;
}

type FormState = {
  title: string;
  description: string;
  status: TaskStatus;
  priority: number;
  urgency: number;
  due_date: string;
  project_id: number | null;
};

export function TaskDetailPanel({ task, projects, people, onClose, onUpdated }: Props) {
  const [form, setForm] = useState<FormState>({
    title: '',
    description: '',
    status: 'backlog',
    priority: 3,
    urgency: 3,
    due_date: '',
    project_id: null,
  });
  const [saving, setSaving] = useState(false);

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
      });
    }
  }, [task]);

  const assignedIds = new Set((task?.people ?? []).map((p) => p.id));

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
    const oldVal: unknown = field === 'due_date' ? (task.due_date ?? '') : (task as Record<string, unknown>)[field];
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
    setSaving(true);
    try {
      const next = assignedIds.has(personId)
        ? [...assignedIds].filter((id) => id !== personId)
        : [...assignedIds, personId];
      await tasksApi.update(task.id, { person_ids: next });
      onUpdated();
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
            className="w-full text-lg font-semibold border-b border-transparent hover:border-gray-300 focus:border-indigo-400 focus:outline-none px-1 py-0.5"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            onBlur={() => handleBlur('title')}
            disabled={saving}
          />

          {/* Status */}
          <div>
            <div className="text-xs text-gray-500 mb-1">Status</div>
            <select
              className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300"
              value={form.status}
              onChange={(e) => handleSelectChange('status', e.target.value as TaskStatus)}
              disabled={saving}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Project */}
          <div>
            <div className="text-xs text-gray-500 mb-1">Project</div>
            <select
              className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300"
              value={form.project_id ?? ''}
              onChange={(e) => handleSelectChange('project_id', e.target.value === '' ? null : Number(e.target.value))}
              disabled={saving}
            >
              <option value="">No project</option>
              {activeProjects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Priority & Urgency */}
          <div className="grid grid-cols-2 gap-3">
            <RatingField
              label="Priority"
              value={form.priority}
              onChange={(v) => handleRatingClick('priority', v)}
              disabled={saving}
            />
            <RatingField
              label="Urgency"
              value={form.urgency}
              onChange={(v) => handleRatingClick('urgency', v)}
              disabled={saving}
            />
          </div>

          {/* Due date */}
          <div>
            <div className="text-xs text-gray-500 mb-1">Due date</div>
            <input
              type="date"
              className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300"
              value={form.due_date}
              onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
              onBlur={() => handleBlur('due_date')}
              disabled={saving}
            />
          </div>

          {/* Description */}
          <div>
            <div className="text-xs text-gray-500 mb-1">Description</div>
            <textarea
              className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300 resize-none"
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
              <div className="text-xs text-gray-500 mb-2">Assignees</div>
              <div className="flex flex-wrap gap-2">
                {people.map((p) => {
                  const assigned = assignedIds.has(p.id);
                  return (
                    <button key={p.id} onClick={() => togglePerson(p.id)} disabled={saving}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs border transition-colors ${assigned ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'}`}>
                      <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${assigned ? 'bg-indigo-400' : 'bg-gray-200'}`}>
                        {p.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)}
                      </span>
                      {p.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="text-xs text-gray-400 pt-2">Created: {task.created_at}</div>
        </div>
      )}
    </SlidePanel>
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
            className={`w-7 h-7 text-xs rounded border transition-colors ${n <= value ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-400 border-gray-200 hover:border-indigo-300'}`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
