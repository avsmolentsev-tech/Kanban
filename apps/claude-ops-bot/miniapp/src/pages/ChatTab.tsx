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

  useEffect(() => {
    if (initialProject) setSelectedProject(initialProject);
  }, [initialProject]);

  useEffect(() => {
    api.chatHistory().then(setMessages).catch(() => {});
    api.projects().then((p) => {
      const visible = p.filter((x) => !x.hidden);
      setProjects(visible);
      if (!selectedProject && visible.length > 0) setSelectedProject(visible[0].name);
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleFileUpload = async (file: File) => {
    if (!selectedProject) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const initData = (() => { try { return WebApp.initData || ""; } catch { return ""; } })();
      const res = await fetch(BASE + "/api/upload/" + encodeURIComponent(selectedProject), {
        method: "POST",
        headers: { "X-Telegram-Init-Data": initData },
        body: formData,
      });
      const data = await res.json();
      setAttachedFile({ name: file.name, path: data.path });
    } catch {
      setAttachedFile(null);
    }
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
          content: "Ошибка: " + (err?.message || "соединение"),
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
      {/* Sticky project pills */}
      <div className="shrink-0 border-b border-white/10 bg-black/20">
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="flex-1 flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
            {projects.map((p) => (
              <button
                key={p.name}
                onClick={() => setSelectedProject(p.name)}
                className={"shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all " +
                  (selectedProject === p.name
                    ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                    : "bg-white/5 text-gray-500 border border-white/5")}
              >
                {p.name}
              </button>
            ))}
          </div>
          <button onClick={handleClear} className="shrink-0 text-[10px] text-gray-600 px-1">Очистить</button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-3" style={{ minHeight: 0 }}>
        {messages.length === 0 && (
          <div className="text-center text-gray-600 mt-8">
            <div className="text-3xl mb-2">⚡</div>
            <div className="text-sm">Начни диалог с Claude</div>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={"flex " + (msg.role === "user" ? "justify-end" : "justify-start")}>
            <div className={"max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words " +
              (msg.role === "user"
                ? "bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-500/20 text-white"
                : "bg-white/5 border border-white/10 text-gray-300")}>
              {msg.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-gray-400 flex gap-1">
              <span className="animate-pulse">●</span>
              <span className="animate-pulse" style={{ animationDelay: "0.2s" }}>●</span>
              <span className="animate-pulse" style={{ animationDelay: "0.4s" }}>●</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Attached file preview */}
      {attachedFile && (
        <div className="shrink-0 px-3 py-1.5 border-t border-white/10 flex items-center gap-2 bg-white/5">
          <span className="text-xs text-cyan-400 truncate flex-1">📎 {attachedFile.name}</span>
          <button onClick={() => setAttachedFile(null)} className="text-gray-500 text-xs">✕</button>
        </div>
      )}

      {/* Input bar */}
      <div className="shrink-0 p-3 border-t border-white/10">
        <div className="flex gap-2 items-end">
          <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => { if (e.target.files?.[0]) handleFileUpload(e.target.files[0]); e.target.value = ""; }} />
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { if (e.target.files?.[0]) handleFileUpload(e.target.files[0]); e.target.value = ""; }} />
          <button onClick={() => fileInputRef.current?.click()} className="shrink-0 w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-gray-500 hover:text-gray-300 transition">📎</button>
          <button onClick={() => cameraInputRef.current?.click()} className="shrink-0 w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-gray-500 hover:text-gray-300 transition">📷</button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Сообщение..."
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-cyan-500/30"
          />
          <button
            onClick={send}
            disabled={sending || (!input.trim() && !attachedFile)}
            className="shrink-0 w-10 h-10 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 flex items-center justify-center text-black font-bold disabled:opacity-30 transition"
          >
            ▶
          </button>
        </div>
      </div>

      <style>{`.scrollbar-hide::-webkit-scrollbar { display: none; }`}</style>
    </div>
  );
}
