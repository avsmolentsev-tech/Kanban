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
            <div className="text-xs text-gray-500 mb-1">Описание</div>
            <textarea
              className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300 resize-none"
              rows={5}
              value={form.body ?? ''}
              onChange={(e) => handleChange('body', e.target.value)}
              onBlur={() => handleBlur('body')}
            />
          </div>

          <div>
            <div className="text-xs text-gray-500 mb-1.5">Категория</div>
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
            <div className="text-xs text-gray-500 mb-1.5">Проект</div>
            <div className="flex flex-wrap gap-2">
              {projects.filter((p) => !p.archived).map((p) => {
                const active = form.project_id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleProjectChange(active ? '' : String(p.id))}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors ${active ? 'border-transparent text-white' : 'border-gray-200 text-gray-600 bg-white hover:border-gray-300'}`}
                    style={active ? { backgroundColor: p.color, borderColor: p.color } : {}}
                  >
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: active ? 'rgba(255,255,255,0.7)' : p.color }} />
                    {p.name}
                  </button>
                );
              })}
            </div>
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
