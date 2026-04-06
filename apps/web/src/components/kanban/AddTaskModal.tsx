import { useState } from 'react';
import { tasksApi } from '../../api/tasks.api';
import type { TaskStatus, Person } from '@pis/shared';

interface Props {
  status: TaskStatus;
  projectId: number | null;
  people: Person[];
  onCreated: () => void;
  onCancel: () => void;
}

export function AddTaskModal({ status, projectId, people, onCreated, onCancel }: Props) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState(3);
  const [personId, setPersonId] = useState<number | null>(people.length > 0 ? people[0].id : null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!title.trim()) return;
    setLoading(true);
    try {
      await tasksApi.create({
        title: title.trim(),
        status,
        priority,
        project_id: projectId ?? undefined,
        person_ids: personId !== null ? [personId] : [],
      });
      onCreated();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-indigo-200 shadow-lg p-3 space-y-2">
      <input
        autoFocus
        className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300"
        placeholder="Task title..."
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); }}
        disabled={loading}
      />
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500">Priority:</label>
        {[1, 2, 3, 4, 5].map((p) => (
          <button key={p} onClick={() => setPriority(p)}
            className={`w-6 h-6 rounded text-xs font-medium ${priority === p ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {p}
          </button>
        ))}
      </div>
      {people.length > 0 && (
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Assign:</label>
          <select
            className="text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:border-indigo-300"
            value={personId ?? ''}
            onChange={(e) => setPersonId(e.target.value ? Number(e.target.value) : null)}
            disabled={loading}
          >
            <option value="">No one</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1">Cancel</button>
        <button onClick={submit} disabled={!title.trim() || loading}
          className="text-xs bg-indigo-600 text-white px-3 py-1 rounded hover:bg-indigo-700 disabled:opacity-50">
          {loading ? '...' : 'Add'}
        </button>
      </div>
    </div>
  );
}
