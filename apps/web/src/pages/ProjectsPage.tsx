import { useEffect, useState } from 'react';
import { useProjectsStore } from '../store';
import { projectsApi } from '../api/projects.api';
import { Badge } from '../components/ui/Badge';
import { ProjectDetailPanel } from '../components/projects/ProjectDetailPanel';
import type { Project } from '@pis/shared';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

export function ProjectsPage() {
  const { projects, loading, fetchProjects } = useProjectsStore();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(COLORS[0]!);
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<Project | null>(null);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  const submit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await projectsApi.create({ name: name.trim(), description: description.trim(), color });
      setName(''); setDescription(''); setColor(COLORS[0]!); setAdding(false);
      fetchProjects();
    } finally { setSubmitting(false); }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-800">Projects</h1>
        {!adding && (
          <button onClick={() => setAdding(true)} className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">
            + New project
          </button>
        )}
      </div>

      {adding && (
        <div className="bg-white rounded-xl border border-indigo-200 shadow-lg p-4 mb-6 max-w-md space-y-3">
          <input autoFocus className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:border-indigo-300"
            placeholder="Project name..." value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setAdding(false); }} />
          <input className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:border-indigo-300"
            placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500 mr-2">Color:</span>
            {COLORS.map((c) => (
              <button key={c} onClick={() => setColor(c)}
                className={`w-6 h-6 rounded-full border-2 transition-all ${color === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                style={{ backgroundColor: c }} />
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className="text-sm text-gray-400 hover:text-gray-600 px-3 py-1.5">Cancel</button>
            <button onClick={submit} disabled={!name.trim() || submitting}
              className="text-sm bg-indigo-600 text-white px-4 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              {submitting ? '...' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {loading && <div className="text-gray-400 text-sm">Loading...</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((p) => (
          <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-4 cursor-pointer hover:border-indigo-300 hover:shadow-sm transition-all" onClick={() => setSelected(p)}>
            <div className="flex items-center gap-2 mb-2"><Badge label={p.status} color={p.color} /><span className="font-medium text-gray-800">{p.name}</span></div>
            <p className="text-sm text-gray-500">{p.description}</p>
          </div>
        ))}
      </div>

      <ProjectDetailPanel
        project={selected}
        onClose={() => setSelected(null)}
        onUpdated={() => { fetchProjects(); setSelected((prev) => prev ? (projects.find((p) => p.id === prev.id) ?? prev) : null); }}
      />
    </div>
  );
}
