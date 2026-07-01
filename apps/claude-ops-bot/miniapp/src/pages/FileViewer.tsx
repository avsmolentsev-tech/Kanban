import { useEffect, useState } from "react";
import { api } from "../lib/api";

export function FileViewer({ projectName, filePath, onBack }: {
  projectName: string;
  filePath: string;
  onBack: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.projectFile(projectName, filePath)
      .then(d => setContent(d.content))
      .catch(e => setError(e.message));
  }, [projectName, filePath]);

  const fileName = filePath.split("/").pop() || filePath;
  const isCode = /\.(ts|tsx|js|jsx|json|py|rs|go|css|html|yaml|yml|toml|md|sh|sql|vue|svelte)$/i.test(fileName);

  if (error) return (
    <div className="p-4">
      <button onClick={onBack} className="text-[#00FFD1] text-sm font-medium mb-4">{"\u2190 \u041D\u0430\u0437\u0430\u0434"}</button>
      <div className="glass-card p-6 text-center">
        <div className="text-3xl mb-2">{"\u26A0\uFE0F"}</div>
        <div className="text-red-400 text-sm">{error}</div>
      </div>
    </div>
  );

  if (content === null) return (
    <div className="p-4">
      <div className="skeleton h-6 w-48 mb-4" />
      {[1,2,3,4,5,6,7,8].map(i => <div key={i} className="skeleton h-4 mb-1" />)}
    </div>
  );

  const lines = content.split("\n");

  return (
    <div className="p-4 animate-fade-in">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="text-[#00FFD1] text-sm font-medium">{"\u2190 \u041D\u0430\u0437\u0430\u0434"}</button>
        <h1 className="text-sm font-bold truncate font-mono">{fileName}</h1>
      </div>
      <div className="text-[11px] text-gray-600 mb-2 font-mono">{filePath} &middot; {lines.length} {"\u0441\u0442\u0440."}</div>
      <div className="glass-card overflow-x-auto scrollbar-hide">
        <pre className={`text-xs leading-5 p-3 ${isCode ? "font-mono" : ""}`}>
          {lines.map((line, i) => (
            <div key={i} className="flex">
              {isCode && <span className="text-gray-700 select-none w-10 text-right pr-3 shrink-0">{i + 1}</span>}
              <span className="text-gray-300">{line || " "}</span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
