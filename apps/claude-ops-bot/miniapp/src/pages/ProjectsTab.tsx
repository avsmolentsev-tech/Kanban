import { useEffect, useState } from "react";
import { api, type Project } from "../lib/api";

export function ProjectsTab({ onSelect }: { onSelect: (name: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.projects().then(setProjects).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="p-4 grid grid-cols-2 gap-3">
      {[1,2,3,4].map(i => <div key={i} className="skeleton h-28" />)}
    </div>
  );

  return (
    <div className="p-4">
      <div className="grid grid-cols-2 gap-3">
        {projects.map((p, i) => (
          <button
            key={p.name}
            onClick={() => onSelect(p.name)}
            className="glass-card glass-card-hover p-4 text-left transition-all duration-200 animate-slide-up active:scale-95"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="text-2xl mb-2">{p.type === "git" ? "📦" : "📁"}</div>
            <div className="font-semibold text-sm text-white truncate">{p.name}</div>
            <div className="text-[11px] text-gray-500 mt-1 font-mono truncate">{p.type}</div>
          </button>
        ))}
      </div>
      {projects.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <div className="text-4xl mb-3">📦</div>
          <div>Нет проектов</div>
        </div>
      )}
    </div>
  );
}
