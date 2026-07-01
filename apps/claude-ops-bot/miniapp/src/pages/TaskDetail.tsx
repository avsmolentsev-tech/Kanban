import { useEffect, useState } from "react";
import { api, type Task } from "../lib/api";

const STATE_COLORS: Record<string, string> = {
  DONE: "bg-emerald-500/20 text-emerald-400",
  RUNNING: "bg-blue-500/20 text-blue-400",
  PLANNING: "bg-yellow-500/20 text-yellow-400",
  FAILED: "bg-red-500/20 text-red-400",
  CREATED: "bg-gray-500/20 text-gray-400",
  VERIFYING: "bg-purple-500/20 text-purple-400",
};

export function TaskDetail({ taskId, onBack, onDiff }: { taskId: number; onBack: () => void; onDiff: () => void }) {
  const [task, setTask] = useState<(Task & { events: any[] }) | null>(null);

  useEffect(() => {
    api.task(taskId).then(setTask);
  }, [taskId]);

  if (!task) return (
    <div className="p-4 space-y-4">
      <div className="skeleton h-6 w-32" />
      <div className="skeleton h-4 w-48" />
      <div className="skeleton h-24" />
    </div>
  );

  const duration = task.duration_ms
    ? task.duration_ms > 60000
      ? `${Math.floor(task.duration_ms / 60000)}\u043C ${Math.round((task.duration_ms % 60000) / 1000)}\u0441`
      : `${Math.round(task.duration_ms / 1000)}\u0441`
    : null;

  return (
    <div className="p-4 space-y-4 animate-fade-in">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-[#00FFD1] text-sm font-medium">{"\u2190 \u041D\u0430\u0437\u0430\u0434"}</button>
      </div>

      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold">{"\u0417\u0430\u0434\u0430\u0447\u0430"} #{task.id}</h1>
        <span className={`text-xs px-2.5 py-1 rounded-full ${STATE_COLORS[task.state] || STATE_COLORS.CREATED}`}>{task.state}</span>
      </div>

      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span className="font-mono bg-white/5 px-2 py-0.5 rounded">{task.project_name}</span>
        <span className="bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded">{task.model}</span>
        {duration && <span>{duration}</span>}
      </div>

      <div className="glass-card p-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{"\u0417\u0430\u0434\u0430\u043D\u0438\u0435"}</h3>
        <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{task.prompt}</p>
      </div>

      {task.plan && (
        <div className="glass-card p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{"\u041F\u043B\u0430\u043D"}</h3>
          <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{task.plan}</p>
        </div>
      )}

      {task.result_summary && (
        <div className="glass-card p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{"\u0420\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442"}</h3>
          <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{task.result_summary}</p>
        </div>
      )}

      {task.diff_stat && (
        <div className="glass-card p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{"\u0418\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F"}</h3>
          <div className="space-y-1">
            {(() => { try { return JSON.parse(task.diff_stat); } catch { return []; } })().map((f: any) => (
              <div key={f.path} className="flex items-center gap-2 text-xs font-mono">
                <span className="text-emerald-400">+{f.added}</span>
                <span className="text-red-400">-{f.removed}</span>
                <span className="text-gray-400 truncate">{f.path}</span>
              </div>
            ))}
          </div>
          <button
            onClick={onDiff}
            className="mt-3 w-full p-2.5 rounded-xl bg-[#4A7CFF]/20 text-[#4A7CFF] text-sm font-medium hover:bg-[#4A7CFF]/30 transition-colors active:scale-[0.98]"
          >
            {"\u{1F4CB} \u041F\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u0442\u044C diff"}
          </button>
        </div>
      )}

      {task.test_result && (
        <div className="glass-card p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{"\u0422\u0435\u0441\u0442\u044B"}</h3>
          <pre className="text-xs text-gray-400 whitespace-pre-wrap font-mono leading-relaxed">{task.test_result}</pre>
        </div>
      )}

      {task.events && task.events.length > 0 && (
        <div className="glass-card p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{"\u0421\u043E\u0431\u044B\u0442\u0438\u044F"}</h3>
          <div className="space-y-2">
            {task.events.slice(-10).map((e: any, i: number) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <div className="w-1.5 h-1.5 rounded-full bg-[#00FFD1]/50 mt-1.5 shrink-0" />
                <div>
                  <span className="text-gray-400">{e.type}</span>
                  {e.detail && <span className="text-gray-600 ml-2">{String(e.detail).slice(0, 80)}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
