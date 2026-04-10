import { useState, useEffect, useRef } from 'react';
import { SlidePanel } from '../ui/SlidePanel';
import { apiPatch, apiGet, apiDelete, apiClient } from '../../api/client';
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

interface Attachment {
  id: number;
  filename: string;
  original_name: string;
  size: number;
  mime_type: string;
  created_at: string;
}

interface Props {
  document: Document | null;
  projects: Project[];
  onClose: () => void;
  onUpdated: () => void;
  onDeleted?: () => void;
}

const CATEGORIES = ['note', 'reference', 'template', 'archive'] as const;

export function DocumentDetailPanel({ document, projects, onClose, onUpdated, onDeleted }: Props) {
  const [form, setForm] = useState<Partial<Document>>({});
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (document) {
      setForm({ ...document });
      loadAttachments(document.id);
    }
  }, [document]);

  const loadAttachments = async (docId: number) => {
    try {
      const data = await apiGet<Attachment[]>(`/documents/${docId}/attachments`);
      setAttachments(data);
    } catch { setAttachments([]); }
  };

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

  const handleUpload = async (file: File) => {
    if (!document) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await apiClient.post(`/documents/${document.id}/attachments`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await loadAttachments(document.id);
    } catch (err) {
      alert('Ошибка загрузки: ' + (err instanceof Error ? err.message : 'unknown'));
    } finally {
      setUploading(false);
    }
  };

  const deleteAttachment = async (attId: number) => {
    await apiDelete(`/documents/attachments/${attId}`);
    if (document) await loadAttachments(document.id);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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

          {/* Project as chips */}
          <div>
            <div className="text-xs text-gray-500 mb-1.5">Проект</div>
            <div className="flex flex-wrap gap-2">
              {projects.filter((p) => !p.archived).map((p) => {
                const active = form.project_id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      const next = active ? null : p.id;
                      setForm(f => ({ ...f, project_id: next }));
                      save('project_id', next);
                    }}
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

          <div>
            <div className="text-xs text-gray-500 mb-1">Категория</div>
            <div className="flex flex-wrap gap-1">
              {CATEGORIES.map((c) => (
                <button key={c} type="button"
                  onClick={() => { setForm(f => ({ ...f, category: c })); save('category', c); }}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors capitalize ${form.category === c ? 'bg-indigo-600 text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs text-gray-500 mb-1">Содержание</div>
            <textarea
              className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300 resize-y"
              rows={8}
              value={form.body ?? ''}
              onChange={(e) => handleChange('body', e.target.value)}
              onBlur={() => handleBlur('body')}
            />
          </div>

          {/* Attachments */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-gray-500">Вложения</div>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="text-xs text-indigo-500 hover:text-indigo-700"
              >
                {uploading ? 'Загрузка...' : '+ Прикрепить файл'}
              </button>
            </div>
            <input ref={fileRef} type="file" className="hidden" onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
              e.target.value = '';
            }} />

            {attachments.length === 0 ? (
              <div
                className="border-2 border-dashed border-gray-200 rounded-lg p-4 text-center text-xs text-gray-400 cursor-pointer hover:border-indigo-300"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f) handleUpload(f);
                }}
              >
                Перетащи файл сюда или нажми
              </div>
            ) : (
              <div className="space-y-1.5">
                {attachments.map(a => (
                  <div key={a.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg text-sm group">
                    <span className="text-gray-400">📎</span>
                    <a href={`/v1/documents/attachments/file/${a.filename}`} target="_blank" rel="noopener noreferrer"
                      className="text-indigo-600 hover:text-indigo-800 truncate flex-1">
                      {a.original_name}
                    </a>
                    <span className="text-xs text-gray-400">{formatSize(a.size)}</span>
                    <button onClick={() => deleteAttachment(a.id)}
                      className="text-xs text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100">✕</button>
                  </div>
                ))}
                <div
                  className="border border-dashed border-gray-200 rounded-lg p-2 text-center text-xs text-gray-400 cursor-pointer hover:border-indigo-300"
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleUpload(f); }}
                >
                  + Ещё файл
                </div>
              </div>
            )}
          </div>

          <div className="text-xs text-gray-400 pt-2">
            <div>Создано: {document.created_at}</div>
            <div>Обновлено: {document.updated_at}</div>
          </div>

          {onDeleted && (
            <button onClick={async () => { if (confirm('Удалить документ?')) { await apiDelete(`/documents/${document.id}`); onDeleted(); onClose(); } }}
              className="w-full py-2 text-sm text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg border border-red-200 transition-colors">
              Удалить документ
            </button>
          )}
        </div>
      )}
    </SlidePanel>
  );
}
