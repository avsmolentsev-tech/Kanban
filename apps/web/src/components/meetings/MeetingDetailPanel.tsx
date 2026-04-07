import { useState, useEffect } from 'react';
import { SlidePanel } from '../ui/SlidePanel';
import { meetingsApi } from '../../api/meetings.api';
import type { Meeting, Project } from '@pis/shared';

interface Props {
  meeting: Meeting | null;
  projects: Project[];
  onClose: () => void;
  onUpdated: () => void;
  onDeleted?: () => void;
  onTranscribe?: () => void;
  transcribing?: boolean;
}

export function MeetingDetailPanel({ meeting, projects, onClose, onUpdated, onDeleted, onTranscribe, transcribing }: Props) {
  const [form, setForm] = useState<Partial<Meeting>>({});

  useEffect(() => {
    if (meeting) setForm({ ...meeting });
  }, [meeting]);

  const save = async (field: string, value: string | number | null) => {
    if (!meeting) return;
    await meetingsApi.update(meeting.id, { [field]: value });
    onUpdated();
  };

  const handleChange = (field: keyof Meeting, value: string | number | null) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  const handleBlur = (field: string) => {
    if (!meeting) return;
    const newVal = (form as unknown as Record<string, unknown>)[field];
    const oldVal = (meeting as unknown as Record<string, unknown>)[field];
    if (newVal !== oldVal) save(field, newVal as string | number | null);
  };

  const handleProjectChange = (val: string) => {
    const projectId = val ? Number(val) : null;
    setForm((f) => ({ ...f, project_id: projectId }));
    save('project_id', projectId);
  };

  return (
    <SlidePanel open={!!meeting} onClose={onClose} title={meeting?.title ?? ''}>
      {meeting && (
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
              <div className="text-xs text-gray-500 mb-1">Дата</div>
              <input
                type="date"
                className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300"
                value={form.date ?? ''}
                onChange={(e) => handleChange('date', e.target.value)}
                onBlur={() => handleBlur('date')}
              />
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Проект</div>
              <select
                className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300 bg-white"
                value={form.project_id ?? ''}
                onChange={(e) => handleProjectChange(e.target.value)}
              >
                <option value="">Без проекта</option>
                {projects.filter((p) => !p.archived).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Transcribe button */}
          {onTranscribe && (
            <button
              onClick={onTranscribe}
              disabled={transcribing}
              className="w-full py-2.5 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
              </svg>
              {transcribing ? 'Транскрибирую...' : 'Загрузить запись встречи'}
            </button>
          )}

          <div>
            <div className="text-xs text-gray-500 mb-1">Содержание / транскрипция</div>
            <textarea
              className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300 resize-none"
              rows={12}
              value={form.summary_raw ?? ''}
              onChange={(e) => handleChange('summary_raw', e.target.value)}
              onBlur={() => handleBlur('summary_raw')}
              placeholder="Текст встречи, заметки, транскрипция..."
            />
          </div>

          {(meeting as unknown as Record<string, unknown>)['vault_path'] && (
            <div className="text-xs text-gray-400 flex items-center gap-1">
              <span>Obsidian:</span>
              <a
                href={`obsidian://open?vault=ObsidianVault&file=${encodeURIComponent(String((meeting as unknown as Record<string, unknown>)['vault_path']).replace('.md', ''))}`}
                className="text-indigo-500 hover:text-indigo-700 underline"
              >
                {String((meeting as unknown as Record<string, unknown>)['vault_path'])}
              </a>
            </div>
          )}

          <div className="text-xs text-gray-400">Создано: {meeting.created_at}</div>

          {/* Delete */}
          {onDeleted && (
            <button
              onClick={async () => {
                if (confirm('Удалить встречу?')) {
                  await meetingsApi.delete(meeting.id);
                  onDeleted();
                  onClose();
                }
              }}
              className="w-full py-2 text-sm text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg border border-red-200 transition-colors"
            >
              Удалить встречу
            </button>
          )}
        </div>
      )}
    </SlidePanel>
  );
}
