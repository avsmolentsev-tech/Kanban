import { useState } from "react";

export function Settings({ onBack }: { onBack: () => void }) {
  const [model, setModel] = useState<"sonnet" | "opus">(() => {
    try { return (localStorage.getItem("forge_model") as any) || "sonnet"; } catch { return "sonnet"; }
  });

  const handleModelChange = (m: "sonnet" | "opus") => {
    setModel(m);
    try { localStorage.setItem("forge_model", m); } catch {}
  };

  return (
    <div className="p-4 animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-[#00FFD1] text-sm font-medium">{"\u2190 \u041D\u0430\u0437\u0430\u0434"}</button>
        <h1 className="text-lg font-bold">{"\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438"}</h1>
      </div>

      <div className="glass-card p-4 mb-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{"\u041C\u043E\u0434\u0435\u043B\u044C \u043F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E"}</h3>
        <div className="flex gap-2">
          {(["sonnet", "opus"] as const).map(m => (
            <button
              key={m}
              onClick={() => handleModelChange(m)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
                model === m ? "gradient-cyan text-black" : "bg-white/5 text-gray-400"
              }`}
            >
              {m === "sonnet" ? "\u2728 Sonnet" : "\u{1F48E} Opus"}
            </button>
          ))}
        </div>
      </div>

      <div className="glass-card p-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{"\u041E \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0438"}</h3>
        <div className="text-sm text-gray-400 space-y-1">
          <div>Forge {"\u2014"} {"\u043C\u043E\u0431\u0438\u043B\u044C\u043D\u0430\u044F dev-\u0441\u0442\u0430\u043D\u0446\u0438\u044F"}</div>
          <div className="text-gray-600 text-xs">v1.0.0</div>
        </div>
      </div>
    </div>
  );
}
