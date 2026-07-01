import { useEffect, useState } from "react";
import { api } from "../lib/api";

export function DiffView({ taskId, onBack }: { taskId: number; onBack: () => void }) {
  const [diff, setDiff] = useState<string | null>(null);

  useEffect(() => {
    api.diff(taskId).then(d => setDiff(d.diff)).catch(() => setDiff("Failed to load diff"));
  }, [taskId]);

  if (diff === null) return (
    <div className="p-4 space-y-2">
      <div className="skeleton h-6 w-32" />
      {[1,2,3,4,5,6,7,8].map(i => <div key={i} className="skeleton h-4" />)}
    </div>
  );

  return (
    <div className="p-4 animate-fade-in">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="text-[#00FFD1] text-sm font-medium">{"\u2190 \u041D\u0430\u0437\u0430\u0434"}</button>
        <h1 className="text-lg font-bold">Diff &middot; #{taskId}</h1>
      </div>
      <div className="glass-card p-3 overflow-x-auto scrollbar-hide">
        <pre className="text-xs font-mono leading-5">
          {diff.split("\n").map((line, i) => {
            let cls = "text-gray-400";
            if (line.startsWith("+") && !line.startsWith("+++")) cls = "text-emerald-400 bg-emerald-500/5";
            else if (line.startsWith("-") && !line.startsWith("---")) cls = "text-red-400 bg-red-500/5";
            else if (line.startsWith("@@")) cls = "text-cyan-400";
            else if (line.startsWith("diff")) cls = "text-yellow-400 font-bold";
            return <div key={i} className={`px-2 ${cls}`}>{line || " "}</div>;
          })}
        </pre>
      </div>
    </div>
  );
}
