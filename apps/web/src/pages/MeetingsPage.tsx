import { useEffect, useState } from 'react';
import { meetingsApi } from '../api/meetings.api';
import type { Meeting } from '@pis/shared';
export function MeetingsPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  useEffect(() => { meetingsApi.list().then(setMeetings); }, []);
  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-gray-800 mb-6">Meetings</h1>
      <div className="space-y-3">
        {meetings.map((m) => (
          <div key={m.id} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="font-medium text-gray-800">{m.title}</div>
            <div className="text-sm text-gray-400 mt-1">{m.date}</div>
            {m.summary_raw && <p className="text-sm text-gray-600 mt-2 line-clamp-2">{m.summary_raw}</p>}
          </div>
        ))}
        {meetings.length === 0 && <div className="text-gray-400 text-sm">No meetings yet</div>}
      </div>
    </div>
  );
}
