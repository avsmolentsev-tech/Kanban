import { useEffect, useState } from "react";
import { api, type Task } from "../lib/api";

const STATE_EMOJI: Record<string, string> = {
  CREATED: "\u{1F195}", PLANNING: "\u{1F9E0}", PLAN_GATE: "\u{1F9ED}", RUNNING: "\u{1F680}",
  VERIFYING: "\u{1F9EA}", DONE: "\u2705", FAILED: "\u274C", REJECTED: "\u{1F6AB}",
};

const STATE_COLORS: Record<string, string> = {
  DONE: "bg-emerald-500/20 text-emerald-400 border-emerald-500/20",
  RUNNING: "bg-blue-500/20 text-blue-400 border-blue-500/20",
  PLANNING: "bg-yellow-500/20 text-yellow-400 border-yellow-500/20",
  PLAN_GATE: "bg-amber-500/20 text-amber-400 border-amber-500/20",
  FAILED: "bg-red-500/20 text-red-400 border-red-500/20",
  CREATED: "bg-gray-500/20 text-gray-400 border-gray-500/20",
  VERIFYING: "bg-purple-500/20 text-purple-400 border-purple-500/20",
  REJECTED: "bg-red-500/20 text-red-400 border-red-500/20",
};

function formatDuration(ms: number | null): string {
  if (!ms) return "";
  if (ms > 60000) return Math.floor(ms / 60000) + "\u043C " + Math.round((ms % 60000) / 1000) + "\u0441";
  return Math.round(ms / 1000) + "\u0441";
}

function formatDate(d: string): string {
  const date = new Date(d);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 3600000) return Math.floor(diffMs / 60000) + " \u043C\u0438\u043D. \u043D\u0430\u0437\u0430\u0434";
  if (diffMs < 86400000) return Math.floor(diffMs / 3600000) + " \u0447. \u043D\u0430\u0437\u0430\u0434";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export function TasksTab({ onSelect }: { onSelect: (id: number) => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.tasks().then(setTasks).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="p-4 space-y-3">
      {[1,2,3,4,5].map(i => <div key={i} className="skeleton h-20" />)}
    </div>
  );

  if (error) return (
    <div className="p-4 text-center">
      <div className="glass-card p-6">
        <div className="text-3xl mb-2">{"\u26A0\uFE0F"}</div>
        <div className="text-red-400 text-sm">{"\u041E\u0448\u0438\u0431\u043A\u0430"}: {error}</div>
      </div>
    </div>
  );

  if (tasks.length === 0) return (
    <div className="p-4 text-center py-20">
      <div className="text-4xl mb-3">{"\u{1F4AD}"}</div>
      <div className="text-gray-500">{"\u041D\u0435\u0442 \u0437\u0430\u0434\u0430\u0447"}</div>
      <div className="text-gray-600 text-sm mt-1">{"\u0421\u043E\u0437\u0434\u0430\u0439\u0442\u0435 \u043F\u0435\u0440\u0432\u0443\u044E \u0432\u043E \u0432\u043A\u043B\u0430\u0434\u043A\u0435 \u0427\u0430\u0442"}</div>
    </div>
  );

  return (
    <div className="p-4 space-y-2.5">
      {tasks.map((t, i) => (
        <button
          key={t.id}
          onClick={() => onSelect(t.id)}
          className="w-full text-left p-4 glass-card glass-card-hover transition-all duration-200 active:scale-[0.98] animate-slide-up"
          style={{ animationDelay: `${i * 40}ms` }}
        >
          <div className="flex items-center gap-2.5 mb-2">
            <span className="text-lg">{STATE_EMOJI[t.state] || "\u2753"}</span>
            <span className="font-semibold text-white text-sm">#{t.id}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${STATE_COLORS[t.state] || STATE_COLORS.CREATED}`}>{t.state}</span>
            <span className="ml-auto text-[11px] text-gray-500">{formatDate(t.created_at)}</span>
          </div>
          <p className="text-sm text-gray-300 truncate leading-relaxed">{t.prompt}</p>
          <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-500">
            <span className="font-mono bg-white/5 px-1.5 py-0.5 rounded">{t.project_name}</span>
            <span>{t.model}</span>
            {t.duration_ms && <span className="ml-auto">{formatDuration(t.duration_ms)}</span>}
          </div>
        </button>
      ))}
    </div>
  );
}
