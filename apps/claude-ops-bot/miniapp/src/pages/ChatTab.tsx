import { useState, useEffect, useRef } from "react";
import { api, type ChatMessage, type Project } from "../lib/api";
import WebApp from "@twa-dev/sdk";

const BASE = import.meta.env.VITE_API_URL || "";

export function ChatTab({ initialProject }: { initialProject?: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>(initialProject || "");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [attachedFile, setAttachedFile] = useState<{ name: string; path: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Sync initialProject prop to state
  useEffect(() => {
    if (initialProject) setSelectedProject(initialProject);
  }, [initialProject]);

  useEffect(() => {
    api.chatHistory().then(setMessages).catch(() => {});
    api.projects().then((p) => {
      const visible = p.filter((x) => !x.hidden);
      setProjects(visible);
      if (visible.length > 0) setSelectedProject(visible[0].name);
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const uploadFile = async (file: File) => {
    if (!selectedProject) return;
    const initData = (() => { try { return WebApp.initData || ""; } catch { return ""; } })();
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(BASE + "/api/upload/" + encodeURIComponent(selectedProject), {
      method: "POST",
      headers: { "X-Telegram-Init-Data": initData },
      body: form,
    });
    if (!res.ok) throw new Error("Upload failed");
    return (await res.json()) as { path: string; filename: string };
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await uploadFile(file);
      if (result) setAttachedFile({ name: file.name, path: result.path });
    } catch {
      // silently ignore
    }
    e.target.value = "";
  };

  const send = async () => {
    if ((!input.trim() && !attachedFile) || sending) return;
    let text = input.trim();
    if (attachedFile) {
      text = "[File: " + attachedFile.name + " -> " + attachedFile.path + "]\n" + text;
    }
    setInput("");
    setAttachedFile(null);

    const userMsg: ChatMessage = {
      id: Date.now(),
      project_name: selectedProject,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    setSending(true);
    try {
      const response = await api.sendChat(text, selectedProject || undefined);
      setMessages((prev) => [
        ...prev,
        { ...response, id: Date.now() + 1, created_at: new Date().toISOString() },
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          project_name: null,
          role: "assistant" as const,
          content: "\u041e\u0448\u0438\u0431\u043a\u0430: " + (err?.message || "\u0441\u043e\u0435\u0434\u0438\u043d\u0435\u043d\u0438\u0435"),
          created_at: new Date().toISOString(),
        },
      ]);
    }
    setSending(false);
  };

  const handleClear = async () => {
    await api.clearChat();
    setMessages([]);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Horizontal project pills */}
      <div className="shrink-0 border-b border-white/10">
        <div className="flex items-center gap-1 px-3 py-2">
          <div className="flex-1 flex gap-1.5 overflow-x-auto scrollbar-hide">
            <button
              onClick={() => setSelectedProject("")}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                selectedProject === ""
                  ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/40"
                  : "bg-white/5 text-gray-400 border border-white/10"
              }`}
            >
              {"\u0412\u0441\u0435"}
            </button>
            {projects.map((p) => (
              <button
                key={p.name}
                onClick={() => setSelectedProject(p.name)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
                  selectedProject === p.name
                    ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/40"
                    : "bg-white/5 text-gray-400 border border-white/10"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
          <button
            onClick={handleClear}
            className="shrink-0 text-[10px] text-gray-500 px-2 py-1"
          >
            {"\u041e\u0447\u0438\u0441\u0442\u0438\u0442\u044c"}
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-3"
        style={{ minHeight: 0 }}
      >
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-8">
            {"\u041d\u0430\u0447\u043d\u0438 \u0434\u0438\u0430\u043b\u043e\u0433 \u0441 Claude"}
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-500/20 text-white"
                  : "bg-white/5 border border-white/10 text-gray-300"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-gray-400">
              <span className="animate-pulse">{"\u25cf"}</span>
              <span className="animate-pulse" style={{ animationDelay: "0.2s" }}>{"\u25cf"}</span>
              <span className="animate-pulse" style={{ animationDelay: "0.4s" }}>{"\u25cf"}</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Attached file preview */}
      {attachedFile && (
        <div className="shrink-0 px-3 pt-2 flex items-center gap-2">
          <div className="flex-1 bg-white/5 border border-cyan-500/20 rounded-lg px-3 py-1.5 text-xs text-cyan-400 truncate">
            {"\ud83d\udcce "}{attachedFile.name}
          </div>
          <button
            onClick={() => setAttachedFile(null)}
            className="text-gray-500 text-sm px-1"
          >
            {"\u2715"}
          </button>
        </div>
      )}

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="*"
        className="hidden"
        onChange={handleFileSelect}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Input bar with upload buttons */}
      <div className="shrink-0 p-3 border-t border-white/10">
        <div className="flex gap-2 items-center">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-gray-400 active:bg-white/10"
          >
            {"\ud83d\udcce"}
          </button>
          <button
            onClick={() => cameraInputRef.current?.click()}
            className="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-gray-400 active:bg-white/10"
          >
            {"\ud83d\udcf7"}
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())
            }
            placeholder={"\u0421\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435..."}
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-cyan-500/30"
          />
          <button
            onClick={send}
            disabled={sending || (!input.trim() && !attachedFile)}
            className="shrink-0 px-4 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 text-black font-semibold text-sm disabled:opacity-30 transition"
          >
            {"\u25b6"}
          </button>
        </div>
      </div>
    </div>
  );
}
