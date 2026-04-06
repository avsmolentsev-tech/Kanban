import { useEffect } from 'react';
import { useProjectsStore } from '../store';
import { Badge } from '../components/ui/Badge';
export function ProjectsPage() {
  const { projects, loading, fetchProjects } = useProjectsStore();
  useEffect(() => { fetchProjects(); }, [fetchProjects]);
  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-gray-800 mb-6">Projects</h1>
      {loading && <div className="text-gray-400 text-sm">Loading...</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((p) => (
          <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-2"><Badge label={p.status} color={p.color} /><span className="font-medium text-gray-800">{p.name}</span></div>
            <p className="text-sm text-gray-500">{p.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
