import { useEffect, useState } from "react";
import { api, type FileEntry, type Task } from "../lib/api";

type SubTab = "files" | "tasks";

const STATE_COLORS: Record<string, string> = {
  DONE: "bg-emerald-500/20 text-emerald-400",
  RUNNING: "bg-blue-500/20 text-blue-400",
  PLANNING: "bg-yellow-500/20 text-yellow-400",
  FAILED: "bg-red-500/20 text-red-400",
  CREATED: "bg-gray-500/20 text-gray-400",
};

export function ProjectDetail({ projectName, onBack, onTask, onFile, onNewTask }: {
  projectName: string;
  onBack: () => void;
  onTask: (id: number) => void;
  onFile: (path: string) => void;
  onNewTask: () => void;
}) {
  const [subTab, setSubTab] = useState<SubTab>("files");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [currentPath, setCurrentPath] = useState("");
  const [pathStack, setPathStack] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.projectFiles(projectName, currentPath || undefined)
      .then(setFiles)
      .catch(() => setFiles([]))
      .finally(() => setLoading(false));
  }, [projectName, currentPath]);

  useEffect(() => {
    api.tasks().then(all => setTasks(all.filter(t => t.project_name === projectName))).catch(() => {});
  }, [projectName]);

  const navigateToDir = (name: string) => {
    setPathStack(prev => [...prev, currentPath]);
    setCurrentPath(currentPath ? currentPath + "/" + name : name);
  };

  const goUp = () => {
    const prev = pathStack[pathStack.length - 1];
    setPathStack(s => s.slice(0, -1));
    setCurrentPath(prev ?? "");
  };

  return (
    <div>
      <div className="px-4 pt-3 pb-2 flex items-center gap-3">
        <button onClick={onBack} className="text-[#00FFD1] text-sm font-medium">← Назад</button>
        <h2 className="text-lg font-bold truncate">{projectName}</h2>
      </div>

      <div className="px-4 flex gap-2 mb-3">
        {(["files", "tasks"] as SubTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setSubTab(tab)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
              subTab === tab ? "gradient-cyan text-black" : "bg-white/5 text-gray-400 hover:bg-white/10"
            }`}
          >
            {tab === "files" ? "📄 Файлы" : "📋 Задачи"}
          </button>
        ))}
      </div>

      {subTab === "files" && (
        <div className="px-4 space-y-1.5 animate-fade-in">
          {currentPath && (
            <div className="flex items-center gap-1 text-xs text-gray-500 mb-2 overflow-x-auto scrollbar-hide">
              <button onClick={() => { setCurrentPath(""); setPathStack([]); }} className="text-[#00FFD1] shrink-0">~</button>
              {currentPath.split("/").map((part, i, arr) => (
                <span key={i} className="shrink-0">
                  <span className="mx-1">/</span>
                  {i === arr.length - 1 ? <span className="text-white">{part}</span> : <span>{part}</span>}
                </span>
              ))}
            </div>
          )}
          {currentPath && (
            <button onClick={goUp} className="w-full text-left p-3 glass-card flex items-center gap-3 active:scale-[0.98] transition-transform">
              <span className="text-lg">⬆️</span>
              <span className="text-sm text-gray-400">..</span>
            </button>
          )}
          {loading ? (
            <div className="space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="skeleton h-12" />)}</div>
          ) : files.map((f, i) => (
            <button
              key={f.name}
              onClick={() => f.isDirectory ? navigateToDir(f.name) : onFile(currentPath ? currentPath + "/" + f.name : f.name)}
              className="w-full text-left p-3 glass-card glass-card-hover flex items-center gap-3 active:scale-[0.98] transition-all animate-slide-up"
              style={{ animationDelay: `${i * 30}ms` }}
            >
              <span className="text-lg">{f.isDirectory ? "📁" : "📄"}</span>
              <span className="text-sm text-white truncate font-mono">{f.name}</span>
              {f.isDirectory && <span className="ml-auto text-gray-600 text-xs">›</span>}
            </button>
          ))}
          {!loading && files.length === 0 && (
            <div className="text-center py-8 text-gray-500 text-sm">Пустая папка</div>
          )}
          <button
            onClick={onNewTask}
            className="w-full mt-4 p-3 rounded-2xl gradient-cyan text-black font-semibold text-sm text-center active:scale-95 transition-transform"
          >
            ⚡ Новая задача
          </button>
        </div>
      )}

      {subTab === "tasks" && (
        <div className="px-4 space-y-2 animate-fade-in">
          {tasks.length === 0 ? (
            <div className="text-center py-8 text-gray-500 text-sm">Нет задач</div>
          ) : tasks.map(t => (
            <button
              key={t.id}
              onClick={() => onTask(t.id)}
              className="w-full text-left p-3 glass-card glass-card-hover transition-all active:scale-[0.98]"
            >
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full ${STATE_COLORS[t.state] || "bg-gray-500/20 text-gray-400"}`}>{t.state}</span>
                <span className="font-medium text-sm">#{t.id}</span>
                <span className="ml-auto text-xs text-gray-500">{t.model}</span>
              </div>
              <p className="text-xs text-gray-400 mt-1.5 truncate">{t.prompt}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
