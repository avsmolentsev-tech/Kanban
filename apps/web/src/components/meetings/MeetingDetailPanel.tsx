import { useState, useEffect } from 'react';
import { SlidePanel } from '../ui/SlidePanel';
import { meetingsApi } from '../../api/meetings.api';
import type { Meeting, Project } from '@pis/shared';

interface Props {
  meeting: Meeting | null;
  projects: Project[];
  onClose: () => void;
  onUpdated: () => void;
}

export function MeetingDetailPanel({ meeting, projects, onClose, onUpdated }: Props) {
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

          <div>
            <div className="text-xs text-gray-500 mb-1">Date</div>
            <input
              type="date"
              className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300"
              value={form.date ?? ''}
              onChange={(e) => handleChange('date', e.target.value)}
              onBlur={() => handleBlur('date')}
            />
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

          <div>
            <div className="text-xs text-gray-500 mb-1">Summary</div>
            <textarea
              className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300 resize-none"
              rows={6}
              value={form.summary_raw ?? ''}
              onChange={(e) => handleChange('summary_raw', e.target.value)}
              onBlur={() => handleBlur('summary_raw')}
            />
          </div>

          <div className="text-xs text-gray-400 pt-2">Created: {meeting.created_at}</div>
        </div>
      )}
    </SlidePanel>
  );
}
