import { useState, useEffect, useMemo } from "react";
import { api, type Project } from "../lib/api";

export function Settings({ onBack }: { onBack: () => void }) {
  const [model, setModel] = useState<"sonnet" | "opus">(() => {
    try { return (localStorage.getItem("forge_model") as any) || "sonnet"; } catch { return "sonnet"; }
  });
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);

  useEffect(() => {
    api.projects().then(setProjects).catch(() => {}).finally(() => setLoadingProjects(false));
  }, []);

  const handleModelChange = (m: "sonnet" | "opus") => {
    setModel(m);
    try { localStorage.setItem("forge_model", m); } catch {}
  };

  const handleToggle = async (name: string, currentlyHidden: boolean) => {
    const newHidden = !currentlyHidden;
    await api.toggleProject(name, newHidden);
    setProjects(prev => prev.map(p => p.name === name ? { ...p, hidden: newHidden } : p));
  };

  const activeCount = useMemo(() => projects.filter(p => !p.hidden).length, [projects]);

  return (
    <div className="p-4 animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-[#00FFD1] text-sm font-medium">{"\u2190 \u041d\u0430\u0437\u0430\u0434"}</button>
        <h1 className="text-lg font-bold">{"\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438"}</h1>
      </div>

      <div className="glass-card p-4 mb-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{"\u041c\u043e\u0434\u0435\u043b\u044c \u043f\u043e \u0443\u043c\u043e\u043b\u0447\u0430\u043d\u0438\u044e"}</h3>
        <div className="flex gap-2">
          {(["sonnet", "opus"] as const).map(m => (
            <button
              key={m}
              onClick={() => handleModelChange(m)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
                model === m ? "gradient-cyan text-black" : "bg-white/5 text-gray-400"
              }`}
            >
              {m === "sonnet" ? "\u2728 Sonnet" : "\uD83D\uDC8E Opus"}
            </button>
          ))}
        </div>
      </div>

      {/* Project management */}
      <div className="glass-card p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{"\u0423\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u0435 \u043f\u0440\u043e\u0435\u043a\u0442\u0430\u043c\u0438"}</h3>
          <span className="text-[11px] text-gray-600">
            {"\u0410\u043a\u0442\u0438\u0432\u043d\u044b\u0445"}: {activeCount} / {"\u0412\u0441\u0435\u0433\u043e"}: {projects.length}
          </span>
        </div>

        {loadingProjects ? (
          <div className="space-y-2">
            {[1,2,3].map(i => <div key={i} className="skeleton h-12 rounded-xl" />)}
          </div>
        ) : (
          <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
            {projects.map(p => {
              const isHidden = !!p.hidden;
              return (
                <div
                  key={p.name}
                  className={`flex items-center justify-between py-2.5 px-3 rounded-xl transition-all ${
                    isHidden ? "opacity-40 bg-white/[0.02]" : "bg-white/5"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span className="text-base shrink-0">{p.type === "git" ? "\uD83D\uDCE6" : "\uD83D\uDCC1"}</span>
                    <div className="min-w-0">
                      <div className="text-sm text-white truncate">{p.name}</div>
                      {isHidden && (
                        <div className="text-[10px] text-gray-600 mt-0.5">{"\u0441\u043a\u0440\u044b\u0442"}</div>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleToggle(p.name, isHidden)}
                    className={`w-11 h-6 rounded-full relative transition-all duration-200 shrink-0 ${
                      !isHidden
                        ? "bg-[#00FFD1]/30 border border-[#00FFD1]/50"
                        : "bg-white/10 border border-white/10"
                    }`}
                  >
                    <div
                      className={`rounded-full absolute top-[3px] transition-all duration-200 ${
                        !isHidden
                          ? "left-[22px] bg-[#00FFD1] shadow-[0_0_8px_rgba(0,255,209,0.6)]"
                          : "left-[3px] bg-gray-500"
                      }`}
                      style={{ width: 18, height: 18 }}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="glass-card p-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{"\u041e \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0438"}</h3>
        <div className="text-sm text-gray-400 space-y-1">
          <div>Forge {"\u2014"} {"\u043c\u043e\u0431\u0438\u043b\u044c\u043d\u0430\u044f dev-\u0441\u0442\u0430\u043d\u0446\u0438\u044f"}</div>
          <div className="text-gray-600 text-xs">v1.0.0</div>
        </div>
      </div>
    </div>
  );
}
