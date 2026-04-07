import { useState, useEffect } from 'react';
import { SlidePanel } from '../ui/SlidePanel';
import { apiPatch, apiDelete } from '../../api/client';
import type { Project } from '@pis/shared';

interface Idea {
  id: number;
  title: string;
  body: string;
  category: 'business' | 'product' | 'personal' | 'growth';
  project_id: number | null;
  vault_path: string | null;
  created_at: string;
}

const CATEGORIES = ['business', 'product', 'personal', 'growth'] as const;
const CAT_COLORS: Record<string, string> = {
  business: '#6366f1',
  product: '#10b981',
  personal: '#f59e0b',
  growth: '#ec4899',
};

interface Props {
  idea: Idea | null;
  projects: Project[];
  onClose: () => void;
  onUpdated: () => void;
  onDeleted?: () => void;
}

export function IdeaDetailPanel({ idea, projects, onClose, onUpdated, onDeleted }: Props) {
  const [form, setForm] = useState<Partial<Idea>>({});

  useEffect(() => {
    if (idea) setForm({ ...idea });
  }, [idea]);

  const save = async (field: string, value: string | number | null) => {
    if (!idea) return;
    await apiPatch(`/ideas/${idea.id}`, { [field]: value });
    onUpdated();
  };

  const handleChange = (field: keyof Idea, value: string | number | null) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  const handleBlur = (field: string) => {
    if (!idea) return;
    const newVal = (form as unknown as Record<string, unknown>)[field];
    const oldVal = (idea as unknown as Record<string, unknown>)[field];
    if (newVal !== oldVal) save(field, newVal as string | number | null);
  };

  const handleCategoryChange = (cat: string) => {
    setForm((f) => ({ ...f, category: cat as Idea['category'] }));
    save('category', cat);
  };

  const handleProjectChange = (val: string) => {
    const projectId = val ? Number(val) : null;
    setForm((f) => ({ ...f, project_id: projectId }));
    save('project_id', projectId);
  };

  return (
    <SlidePanel open={!!idea} onClose={onClose} title={idea?.title ?? ''}>
      {idea && (
        <div className="space-y-4">
          <div>
            <input
              className="w-full text-lg font-semibold border-b border-transparent hover:border-gray-300 focus:border-indigo-400 focus:outline-none px-1 py-0.5"
              value={form.title ?? ''}
              onChange={(e) => handleChange('title', e.target.value)}
              onBlur={() => handleBlur('title')}
            />
          </div>

          <div>
            <div className="text-xs text-gray-500 mb-1">Description</div>
            <textarea
              className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300 resize-none"
              rows={5}
              value={form.body ?? ''}
              onChange={(e) => handleChange('body', e.target.value)}
              onBlur={() => handleBlur('body')}
            />
          </div>

          <div>
            <div className="text-xs text-gray-500 mb-1.5">Category</div>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => handleCategoryChange(c)}
                  className={`text-xs px-2.5 py-1 rounded-full border capitalize transition-colors ${
                    form.category === c ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                  }`}
                  style={form.category === c ? { backgroundColor: CAT_COLORS[c] } : undefined}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs text-gray-500 mb-1">Project</div>
            <select
              className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300 bg-white"
              value={form.project_id ?? ''}
              onChange={(e) => handleProjectChange(e.target.value)}
            >
              <option value="">No project</option>
              {projects.filter((p) => !p.archived).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="text-xs text-gray-400 pt-2">Создано: {idea.created_at.split('T')[0]}</div>

          {onDeleted && (
            <button
              onClick={async () => {
                if (confirm('Удалить идею?')) {
                  await apiDelete(`/ideas/${idea.id}`);
                  onDeleted();
                  onClose();
                }
              }}
              className="w-full py-2 text-sm text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg border border-red-200 transition-colors"
            >
              Удалить идею
            </button>
          )}
        </div>
      )}
    </SlidePanel>
  );
}
