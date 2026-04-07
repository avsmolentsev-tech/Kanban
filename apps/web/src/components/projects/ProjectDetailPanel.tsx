import { useState, useEffect } from 'react';
import { SlidePanel } from '../ui/SlidePanel';
import { projectsApi } from '../../api/projects.api';
import type { Project, ProjectStatus } from '@pis/shared';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];
const STATUSES: ProjectStatus[] = ['active', 'paused', 'completed', 'archived'];

interface Props {
  project: Project | null;
  onClose: () => void;
  onUpdated: () => void;
  onDeleted?: () => void;
}

export function ProjectDetailPanel({ project, onClose, onUpdated, onDeleted }: Props) {
  const [form, setForm] = useState<Partial<Project>>({});

  useEffect(() => {
    if (project) setForm({ ...project });
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

  const handleSelectChange = (field: string, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    save(field, value);
  };

  const handleColorChange = (color: string) => {
    setForm((f) => ({ ...f, color }));
    save('color', color);
  };

  return (
    <SlidePanel open={!!project} onClose={onClose} title={project?.name ?? ''}>
      {project && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: form.color ?? project.color }} />
            <input
              className="flex-1 text-lg font-semibold border-b border-transparent hover:border-gray-300 focus:border-indigo-400 focus:outline-none px-1 py-0.5"
              value={form.name ?? ''}
              onChange={(e) => handleChange('name', e.target.value)}
              onBlur={() => handleBlur('name')}
            />
          </div>

          <div>
            <div className="text-xs text-gray-500 mb-1">Description</div>
            <textarea
              className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300 resize-none"
              rows={3}
              value={form.description ?? ''}
              onChange={(e) => handleChange('description', e.target.value)}
              onBlur={() => handleBlur('description')}
            />
          </div>

          <div>
            <div className="text-xs text-gray-500 mb-1.5">Status</div>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => handleSelectChange('status', s)}
                  className={`text-xs px-3 py-1 rounded-full border capitalize transition-colors ${
                    form.status === s ? 'bg-indigo-600 text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs text-gray-500 mb-1.5">Color</div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => handleColorChange(c)}
                  className={`w-6 h-6 rounded-full border-2 transition-all ${
                    form.color === c ? 'border-gray-800 scale-110' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="text-xs text-gray-400 pt-2">Создано: {project.created_at}</div>

          {onDeleted && (
            <button
              onClick={async () => {
                if (confirm(`Удалить проект "${project.name}"?`)) {
                  await projectsApi.delete(project.id);
                  onDeleted();
                  onClose();
                }
              }}
              className="w-full py-2 text-sm text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg border border-red-200 transition-colors"
            >
              Удалить проект
            </button>
          )}
        </div>
      )}
    </SlidePanel>
  );
}
