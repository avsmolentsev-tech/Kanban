import { useEffect, useState, useMemo } from "react";
import { api, type Project } from "../lib/api";

export function ProjectsTab({ onSelect }: { onSelect: (name: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.projects().then(setProjects).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const visibleProjects = useMemo(
    () => projects.filter(p => !p.hidden),
    [projects]
  );

  const filtered = useMemo(
    () => visibleProjects.filter(p => p.name.toLowerCase().includes(search.toLowerCase())),
    [visibleProjects, search]
  );

  const handleHide = async (e: React.MouseEvent, name: string) => {
    e.stopPropagation();
    await api.toggleProject(name, true);
    setProjects(prev => prev.map(p => p.name === name ? { ...p, hidden: true } : p));
  };

  if (loading) return (
    <div className="p-4 grid grid-cols-2 gap-3">
      {[1,2,3,4].map(i => <div key={i} className="skeleton h-28" />)}
    </div>
  );

  return (
    <div className="p-4">
      {/* Search bar */}
      <div className="glass-card mb-4 flex items-center gap-2 px-3 py-2.5">
        <svg className="w-4 h-4 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск проектов..."
          className="bg-transparent border-none outline-none text-sm text-white placeholder-gray-600 w-full"
        />
        {search && (
          <button onClick={() => setSearch("")} className="text-gray-500 text-xs">✕</button>
        )}
      </div>

      {/* Count */}
      <div className="text-[11px] text-gray-600 mb-3 px-1">
        {filtered.length} из {projects.length} проектов
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 gap-3">
        {filtered.map((p, i) => (
          <button
            key={p.name}
            onClick={() => onSelect(p.name)}
            className="glass-card glass-card-hover p-4 text-left transition-all duration-200 animate-slide-up active:scale-95 relative group"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <button
              onClick={(e) => handleHide(e, p.name)}
              className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center bg-white/5 opacity-60 hover:opacity-100 hover:bg-white/15 transition-all text-gray-500 hover:text-gray-300 text-xs"
              title="Скрыть"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
            </button>
            <div className="text-2xl mb-2">{p.type === "git" ? "📦" : "📁"}</div>
            <div className="font-semibold text-sm text-white truncate">{p.name}</div>
            <div className="text-[11px] text-gray-500 mt-1 font-mono truncate">{p.type}</div>
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <div className="text-4xl mb-3">{search ? "🔍" : "📦"}</div>
          <div>{search ? "Ничего не найдено" : "Нет проектов"}</div>
        </div>
      )}
    </div>
  );
}
