import { useState } from 'react';
import { projectsApi } from '../../api/projects.api';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

interface Props {
  onCreated: () => void;
}

export function AddProjectForm({ onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]!);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await projectsApi.create({ name: name.trim(), color });
      setName('');
      setOpen(false);
      onCreated();
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-2 text-sm text-gray-400 hover:text-indigo-600 transition-colors ml-2 mt-2">
        <span className="text-lg leading-none">+</span> Новый проект
      </button>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-indigo-200 shadow-lg p-3 ml-2 mt-2 w-72 space-y-2">
      <input
        autoFocus
        className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300"
        placeholder="Project name..."
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { setOpen(false); setName(''); } }}
        disabled={loading}
      />
      <div className="flex items-center gap-1">
        <span className="text-xs text-gray-500 mr-1">Color:</span>
        {COLORS.map((c) => (
          <button key={c} onClick={() => setColor(c)}
            className={`w-5 h-5 rounded-full border-2 transition-all ${color === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
            style={{ backgroundColor: c }} />
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={() => { setOpen(false); setName(''); }} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1">Cancel</button>
        <button onClick={submit} disabled={!name.trim() || loading}
          className="text-xs bg-indigo-600 text-white px-3 py-1 rounded hover:bg-indigo-700 disabled:opacity-50">
          {loading ? '...' : 'Create'}
        </button>
      </div>
    </div>
  );
}
