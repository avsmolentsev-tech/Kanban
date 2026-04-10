import { useState } from 'react';
import { aiApi } from '../../api/ai.api';

interface Message { role: 'user' | 'assistant'; content: string; }

export function ClaudeChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const send = async () => {
    const content = input.trim();
    if (!content || loading) return;
    const newMsgs: Message[] = [...messages, { role: 'user', content }];
    setMessages(newMsgs); setInput(''); setLoading(true);
    try {
      const { reply } = await aiApi.chat(newMsgs);
      setMessages([...newMsgs, { role: 'assistant', content: reply }]);
    } catch (e) {
      setMessages([...newMsgs, { role: 'assistant', content: `Ошибка: ${e instanceof Error ? e.message : 'Неизвестная'}` }]);
    } finally { setLoading(false); }
  };

  return (
    <div className="flex flex-col h-full border-l bg-white">
      <div className="px-3 py-2 border-b text-sm font-medium text-gray-700">Чат с Claude</div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`text-sm ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
            <span className={`inline-block px-3 py-2 rounded-lg max-w-xs ${m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-800'}`}>{m.content}</span>
          </div>
        ))}
        {loading && <div className="text-sm text-gray-400">Думаю...</div>}
      </div>
      <div className="p-3 border-t flex gap-2">
        <input className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-300"
          value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Спросите что угодно..." disabled={loading} />
        <button onClick={send} disabled={!input.trim() || loading} className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50">Отправить</button>
      </div>
    </div>
  );
}
