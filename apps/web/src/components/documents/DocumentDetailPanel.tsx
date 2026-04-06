import { useState, useEffect } from 'react';
import { SlidePanel } from '../ui/SlidePanel';
import { apiPatch } from '../../api/client';
import type { Project } from '@pis/shared';

export interface Document {
  id: number;
  title: string;
  body: string;
  project_id: number | null;
  category: 'note' | 'reference' | 'template' | 'archive';
  vault_path: string | null;
  created_at: string;
  updated_at: string;
}

interface Props {
  document: Document | null;
  projects: Project[];
  onClose: () => void;
  onUpdated: () => void;
}

const CATEGORIES = ['note', 'reference', 'template', 'archive'] as const;

export function DocumentDetailPanel({ document, projects, onClose, onUpdated }: Props) {
  const [form, setForm] = useState<Partial<Document>>({});

  useEffect(() => {
    if (document) setForm({ ...document });
  }, [document]);

  const save = async (field: string, value: string | number | null) => {
    if (!document) return;
    await apiPatch(`/documents/${document.id}`, { [field]: value });
    onUpdated();
  };

  const handleChange = (field: keyof Document, value: string | number | null) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  const handleBlur = (field: keyof Document) => {
    if (!document) return;
    const newVal = (form as unknown as Record<string, unknown>)[field];
    const oldVal = (document as unknown as Record<string, unknown>)[field];
    if (newVal !== oldVal) save(field, newVal as string | number | null);
  };

  const handleSelectChange = (field: keyof Document, value: string) => {
    const parsed = field === 'project_id' ? (value ? Number(value) : null) : value;
    setForm((f) => ({ ...f, [field]: parsed }));
    save(field, parsed as string | number | null);
  };

  return (
    <SlidePanel open={!!document} onClose={onClose} title={document?.title ?? ''}>
      {document && (
        <div className="space-y-4">
          <div>
            <input
              className="w-full text-lg font-semibold border-b border-transparent hover:border-gray-300 focus:border-indigo-400 focus:outline-none px-1 py-0.5"
              value={form.title ?? ''}
              onChange={(e) => handleChange('title', e.target.value)}
              onBlur={() => handleBlur('title')}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-gray-500 mb-1">Category</div>
              <select
                className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300 bg-white"
                value={form.category ?? 'note'}
                onChange={(e) => handleSelectChange('category', e.target.value)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Project</div>
              <select
                className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300 bg-white"
                value={form.project_id ?? ''}
                onChange={(e) => handleSelectChange('project_id', e.target.value)}
              >
                <option value="">No project</option>
                {projects.filter((p) => !p.archived).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="text-xs text-gray-500 mb-1">Body</div>
            <textarea
              className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300 resize-none"
              rows={8}
              value={form.body ?? ''}
              onChange={(e) => handleChange('body', e.target.value)}
              onBlur={() => handleBlur('body')}
            />
          </div>

          <div className="text-xs text-gray-400 pt-2">
            <div>Created: {document.created_at}</div>
            <div>Updated: {document.updated_at}</div>
          </div>
        </div>
      )}
    </SlidePanel>
  );
}
