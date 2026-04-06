import { useEffect, useState } from 'react';
import { meetingsApi } from '../api/meetings.api';
import { useProjectsStore } from '../store';
import type { Meeting } from '@pis/shared';
import { MeetingDetailPanel } from '../components/meetings/MeetingDetailPanel';

export function MeetingsPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selected, setSelected] = useState<Meeting | null>(null);
  const { projects, fetchProjects } = useProjectsStore();

  const load = () => { meetingsApi.list().then(setMeetings); };
  useEffect(() => { load(); fetchProjects(); }, [fetchProjects]);

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-gray-800 mb-6">Meetings</h1>
      <div className="space-y-3">
        {meetings.map((m) => (
          <div key={m.id} className="bg-white rounded-xl border border-gray-200 p-4 cursor-pointer hover:border-indigo-300 hover:shadow-sm transition-all" onClick={() => setSelected(m)}>
            <div className="font-medium text-gray-800">{m.title}</div>
            <div className="text-sm text-gray-400 mt-1">{m.date}</div>
            {m.summary_raw && <p className="text-sm text-gray-600 mt-2 line-clamp-2">{m.summary_raw}</p>}
          </div>
        ))}
        {meetings.length === 0 && <div className="text-gray-400 text-sm">No meetings yet</div>}
      </div>

      <MeetingDetailPanel
        meeting={selected}
        projects={projects}
        onClose={() => setSelected(null)}
        onUpdated={() => { load(); setSelected((prev) => prev ? { ...prev } : null); }}
      />
    </div>
  );
}
