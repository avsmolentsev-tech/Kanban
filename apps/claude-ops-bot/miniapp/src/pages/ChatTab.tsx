import { useState, useEffect, useRef } from 'react';
import { api, type ChatMessage, type Project } from '../lib/api';

export function ChatTab() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.chatHistory().then(setMessages).catch(() => {});
    api.projects().then((p) => { setProjects(p); if (p.length > 0) setSelectedProject(p[0].name); });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    if (!input.trim() || sending) return;
    const text = input.trim();
    setInput('');

    // Optimistically add user message
    const userMsg: ChatMessage = { id: Date.now(), project_name: selectedProject, role: 'user', content: text, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);

    setSending(true);
    try {
      const response = await api.sendChat(text, selectedProject || undefined);
      setMessages(prev => [...prev, { ...response, id: Date.now() + 1, created_at: new Date().toISOString() }]);
    } catch (e) {
      setMessages(prev => [...prev, { id: Date.now() + 1, project_name: null, role: 'assistant', content: '\u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u043e\u0435\u0434\u0438\u043d\u0435\u043d\u0438\u044f', created_at: new Date().toISOString() }]);
    }
    setSending(false);
  };

  const handleClear = async () => {
    await api.clearChat();
    setMessages([]);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header with project selector */}
      <div className="p-3 border-b border-white/10 flex items-center gap-2">
        <select
          value={selectedProject}
          onChange={(e) => setSelectedProject(e.target.value)}
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm"
        >
          <option value="">{"\u0411\u0435\u0437 \u043f\u0440\u043e\u0435\u043a\u0442\u0430"}</option>
          {projects.map(p => (
            <option key={p.name} value={p.name}>{p.name}</option>
          ))}
        </select>
        <button onClick={handleClear} className="text-xs text-gray-500 px-2 py-2">{"\u041e\u0447\u0438\u0441\u0442\u0438\u0442\u044c"}</button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-3" style={{ minHeight: 0 }}>
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-8">{"\u041d\u0430\u0447\u043d\u0438 \u0434\u0438\u0430\u043b\u043e\u0433 \u0441 Claude"}</div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
              msg.role === 'user'
                ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-500/20 text-white'
                : 'bg-white/5 border border-white/10 text-gray-300'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-gray-400">
              <span className="animate-pulse">{"\u25cf"}</span>
              <span className="animate-pulse" style={{animationDelay: '0.2s'}}>{"\u25cf"}</span>
              <span className="animate-pulse" style={{animationDelay: '0.4s'}}>{"\u25cf"}</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="shrink-0 p-3 border-t border-white/10">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
            placeholder={"\u0421\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435..."}
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-cyan-500/30"
          />
          <button
            onClick={send}
            disabled={sending || !input.trim()}
            className="px-4 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 text-black font-semibold text-sm disabled:opacity-30 transition"
          >
            {"\u25b6"}
          </button>
        </div>
      </div>
    </div>
  );
}
