import { useEffect, useState } from "react";
import { api, type Project } from "../lib/api";

export function ChatTab({ preselectedProject, onTaskCreated }: { preselectedProject?: string; onTaskCreated: (id: number) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState(preselectedProject || "");
  const [model, setModel] = useState<"sonnet" | "opus">("sonnet");
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ id: number } | null>(null);

  useEffect(() => {
    api.projects().then(p => {
      setProjects(p);
      if (!selectedProject && p.length > 0) setSelectedProject(p[0].name);
    }).catch(() => {});
  }, []);

  const handleSend = async () => {
    if (!selectedProject || !prompt.trim() || sending) return;
    setSending(true);
    try {
      const task = await api.createTask(selectedProject, prompt.trim(), model);
      setSent(task);
      setPrompt("");
    } catch {
      alert("\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u0438 \u0437\u0430\u0434\u0430\u0447\u0438");
    }
    setSending(false);
  };

  if (sent) return (
    <div className="p-4 flex flex-col items-center justify-center py-20 animate-fade-in">
      <div className="text-5xl mb-4">{"\u2705"}</div>
      <h2 className="text-lg font-bold mb-2">{"\u0417\u0430\u0434\u0430\u0447\u0430"} #{sent.id} {"\u0441\u043E\u0437\u0434\u0430\u043D\u0430"}</h2>
      <p className="text-gray-500 text-sm mb-6">{"\u041E\u043D\u0430 \u0441\u043A\u043E\u0440\u043E \u043D\u0430\u0447\u043D\u0451\u0442 \u0432\u044B\u043F\u043E\u043B\u043D\u044F\u0442\u044C\u0441\u044F"}</p>
      <div className="flex gap-3">
        <button
          onClick={() => onTaskCreated(sent.id)}
          className="px-6 py-2.5 rounded-xl gradient-cyan text-black font-semibold text-sm active:scale-95 transition-transform"
        >
          {"\u041E\u0442\u043A\u0440\u044B\u0442\u044C"}
        </button>
        <button
          onClick={() => setSent(null)}
          className="px-6 py-2.5 rounded-xl bg-white/5 text-gray-300 font-medium text-sm active:scale-95 transition-transform"
        >
          {"\u0415\u0449\u0451"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="p-4 flex flex-col h-[calc(100vh-8rem)] animate-fade-in">
      <h2 className="text-lg font-bold mb-4">{"\u26A1 \u041D\u043E\u0432\u0430\u044F \u0437\u0430\u0434\u0430\u0447\u0430"}</h2>

      {/* Project selector */}
      <div className="mb-3">
        <label className="text-xs text-gray-500 uppercase tracking-wider mb-1.5 block">{"\u041F\u0440\u043E\u0435\u043A\u0442"}</label>
        <div className="glass-card overflow-hidden">
          <select
            value={selectedProject}
            onChange={e => setSelectedProject(e.target.value)}
            className="w-full bg-transparent text-white text-sm p-3 outline-none appearance-none cursor-pointer"
          >
            {projects.map(p => <option key={p.name} value={p.name} className="bg-[#0d1423]">{p.name}</option>)}
          </select>
        </div>
      </div>

      {/* Model toggle */}
      <div className="mb-4">
        <label className="text-xs text-gray-500 uppercase tracking-wider mb-1.5 block">{"\u041C\u043E\u0434\u0435\u043B\u044C"}</label>
        <div className="glass-card flex p-1 gap-1">
          {(["sonnet", "opus"] as const).map(m => (
            <button
              key={m}
              onClick={() => setModel(m)}
              className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${
                model === m ? "gradient-cyan text-black" : "text-gray-400 hover:text-white"
              }`}
            >
              {m === "sonnet" ? "\u2728 Sonnet" : "\u{1F48E} Opus"}
            </button>
          ))}
        </div>
      </div>

      {/* Prompt textarea */}
      <div className="flex-1 mb-4">
        <label className="text-xs text-gray-500 uppercase tracking-wider mb-1.5 block">{"\u041E\u043F\u0438\u0441\u0430\u043D\u0438\u0435 \u0437\u0430\u0434\u0430\u0447\u0438"}</label>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder={"\u041E\u043F\u0438\u0448\u0438\u0442\u0435 \u0447\u0442\u043E \u043D\u0443\u0436\u043D\u043E \u0441\u0434\u0435\u043B\u0430\u0442\u044C..."}
          className="w-full h-full min-h-[120px] bg-transparent text-sm text-white placeholder-gray-600 resize-none outline-none p-4 glass-card leading-relaxed"
        />
      </div>

      {/* Send button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSend}
          disabled={!prompt.trim() || !selectedProject || sending}
          className="flex-1 py-3 rounded-2xl gradient-cyan text-black font-bold text-sm disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 transition-all flex items-center justify-center gap-2"
        >
          {sending ? (
            <span className="inline-block w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
          ) : (
            <>{"\u25B6 \u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C"}</>
          )}
        </button>
      </div>
    </div>
  );
}
