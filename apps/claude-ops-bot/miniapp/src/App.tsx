import { useState, useEffect, type ReactNode } from "react";
import WebApp from "@twa-dev/sdk";
import { ProjectsTab } from "./pages/ProjectsTab";
import { ProjectDetail } from "./pages/ProjectDetail";
import { TasksTab } from "./pages/TasksTab";
import { TaskDetail } from "./pages/TaskDetail";
import { ChatTab } from "./pages/ChatTab";
import { DiffView } from "./pages/DiffView";
import { FileViewer } from "./pages/FileViewer";
import { Settings } from "./pages/Settings";
import "./index.css";

try { WebApp.ready(); WebApp.expand(); } catch {}

type Page =
  | { type: "projects" }
  | { type: "project-detail"; name: string }
  | { type: "tasks" }
  | { type: "task-detail"; taskId: number }
  | { type: "chat"; projectName?: string }
  | { type: "diff"; taskId: number }
  | { type: "file"; projectName: string; filePath: string }
  | { type: "settings" };

type Tab = "projects" | "tasks" | "chat";

const TabIcon = ({ active, children }: { active: boolean; children: ReactNode }) => (
  <div className={`flex flex-col items-center gap-1 transition-all duration-200 ${active ? "text-[#00FFD1]" : "text-gray-500"}`}>
    {children}
    {active && <div className="w-1 h-1 rounded-full bg-[#00FFD1] shadow-[0_0_6px_rgba(0,255,209,0.8)]" />}
  </div>
);

export default function App() {
  const [page, setPage] = useState<Page>({ type: "projects" });
  const [activeTab, setActiveTab] = useState<Tab>("projects");
  const [viewportHeight, setViewportHeight] = useState<number>(() => window.innerHeight);

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;

    const updateHeight = () => {
      if (tg?.viewportStableHeight && tg.viewportStableHeight > 100) {
        setViewportHeight(tg.viewportStableHeight);
      } else {
        setViewportHeight(window.innerHeight);
      }
    };

    if (tg) {
      tg.onEvent("viewportChanged", updateHeight);
      updateHeight();
    }

    // Fallback for non-Telegram environments
    window.addEventListener("resize", updateHeight);

    return () => {
      if (tg) tg.offEvent("viewportChanged", updateHeight);
      window.removeEventListener("resize", updateHeight);
    };
  }, []);

  const navigate = (p: Page) => {
    setPage(p);
    if (p.type === "projects") setActiveTab("projects");
    else if (p.type === "tasks") setActiveTab("tasks");
    else if (p.type === "chat") setActiveTab("chat");
  };

  const showTabBar = ["projects", "tasks", "chat"].includes(page.type);

  return (
    <div
      className="bg-[#0a0e1a] text-white flex flex-col overflow-hidden"
      style={{ height: viewportHeight + "px" }}
    >
      <header className="shrink-0 z-50 glass-surface border-b border-white/5 px-4 py-3 flex items-center justify-between">
        <h1 className="text-xl font-bold gradient-text tracking-tight">Forge</h1>
        <button
          onClick={() => navigate({ type: "settings" })}
          className="w-9 h-9 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 transition-colors"
        >
          <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
        </button>
      </header>

      <main className="flex-1 overflow-y-auto overscroll-contain" style={{ minHeight: 0 }}>
        <div className="animate-fade-in h-full" key={page.type + ("taskId" in page ? String(page.taskId) : "") + ("name" in page ? page.name : "") + ("projectName" in page ? (page.projectName || "") : "")}>
          {page.type === "projects" && <ProjectsTab onSelect={(name) => navigate({ type: "project-detail", name })} />}
          {page.type === "project-detail" && (
            <ProjectDetail
              projectName={page.name}
              onBack={() => navigate({ type: "projects" })}
              onTask={(id) => setPage({ type: "task-detail", taskId: id })}
              onFile={(path) => setPage({ type: "file", projectName: page.name, filePath: path })}
              onNewTask={() => navigate({ type: "chat", projectName: page.name })}
            />
          )}
          {page.type === "tasks" && <TasksTab onSelect={(id) => setPage({ type: "task-detail", taskId: id })} />}
          {page.type === "task-detail" && (
            <TaskDetail
              taskId={page.taskId}
              onBack={() => navigate({ type: "tasks" })}
              onDiff={() => setPage({ type: "diff", taskId: page.taskId })}
            />
          )}
          {page.type === "chat" && <ChatTab initialProject={page.projectName} />}
          {page.type === "diff" && <DiffView taskId={page.taskId} onBack={() => setPage({ type: "task-detail", taskId: page.taskId })} />}
          {page.type === "file" && (
            <FileViewer
              projectName={page.projectName}
              filePath={page.filePath}
              onBack={() => setPage({ type: "project-detail", name: page.projectName })}
            />
          )}
          {page.type === "settings" && <Settings onBack={() => navigate({ type: activeTab })} />}
        </div>
      </main>

      {showTabBar && (
        <nav className="shrink-0 glass-surface border-t border-white/5">
          <div className="flex justify-around items-center h-16 max-w-lg mx-auto">
            <button onClick={() => navigate({ type: "projects" })} className="flex-1 flex justify-center py-2">
              <TabIcon active={activeTab === "projects"}>
                <span className="text-lg">{"\ud83d\udcc1"}</span>
                <span className="text-[10px] font-medium">{"\u041f\u0440\u043e\u0435\u043a\u0442\u044b"}</span>
              </TabIcon>
            </button>
            <button onClick={() => navigate({ type: "tasks" })} className="flex-1 flex justify-center py-2">
              <TabIcon active={activeTab === "tasks"}>
                <span className="text-lg">{"\ud83d\udcac"}</span>
                <span className="text-[10px] font-medium">{"\u0417\u0430\u0434\u0430\u0447\u0438"}</span>
              </TabIcon>
            </button>
            <button onClick={() => navigate({ type: "chat" })} className="flex-1 flex justify-center py-2">
              <TabIcon active={activeTab === "chat"}>
                <span className="text-lg">{"\u26a1"}</span>
                <span className="text-[10px] font-medium">{"\u0427\u0430\u0442"}</span>
              </TabIcon>
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}
