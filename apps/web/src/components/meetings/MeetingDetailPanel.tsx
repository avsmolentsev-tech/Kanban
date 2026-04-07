import { useState, useEffect, useRef } from 'react';
import { SlidePanel } from '../ui/SlidePanel';
import { meetingsApi } from '../../api/meetings.api';
import { apiPost } from '../../api/client';
import type { Meeting, Project } from '@pis/shared';

interface Props {
  meeting: Meeting | null;
  projects: Project[];
  onClose: () => void;
  onUpdated: () => void;
  onDeleted?: () => void;
  onTranscribe?: () => void;
  transcribing?: boolean;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function MeetingDetailPanel({ meeting, projects, onClose, onUpdated, onDeleted, onTranscribe, transcribing }: Props) {
  const [form, setForm] = useState<Partial<Meeting>>({});
  const [tab, setTab] = useState<'details' | 'chat'>('details');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (meeting) {
      setForm({ ...meeting });
      setChatMessages([]);
      setTab('details');
    }
  }, [meeting]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const save = async (field: string, value: string | number | null) => {
    if (!meeting) return;
    await meetingsApi.update(meeting.id, { [field]: value });
    onUpdated();
  };

  const handleChange = (field: keyof Meeting, value: string | number | null) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  const handleBlur = (field: string) => {
    if (!meeting) return;
    const newVal = (form as unknown as Record<string, unknown>)[field];
    const oldVal = (meeting as unknown as Record<string, unknown>)[field];
    if (newVal !== oldVal) save(field, newVal as string | number | null);
  };

  const handleProjectChange = (val: string) => {
    const projectId = val ? Number(val) : null;
    setForm((f) => ({ ...f, project_id: projectId }));
    save('project_id', projectId);
  };

  const sendChat = async () => {
    if (!chatInput.trim() || !meeting) return;
    const userMsg: ChatMessage = { role: 'user', content: chatInput.trim() };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput('');
    setChatLoading(true);

    try {
      const projectName = meeting.project_id
        ? projects.find((p) => p.id === meeting.project_id)?.name ?? ''
        : '';

      const context = `Контекст встречи:\nНазвание: ${meeting.title}\nДата: ${meeting.date}\nПроект: ${projectName || 'не указан'}\n\nСодержание встречи:\n${form.summary_raw || '(пусто)'}\n\nОтвечай на русском. Если пользователь просит выделить задачи, договорённости, ключевые моменты — делай это по содержанию встречи.`;

      const data = await apiPost<{ reply: string }>('/ai/chat', {
        messages: [...chatMessages, userMsg],
        context,
      });
      setChatMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      setChatMessages((prev) => [...prev, { role: 'assistant', content: `Ошибка: ${err instanceof Error ? err.message : 'unknown'}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <SlidePanel open={!!meeting} onClose={onClose} title={meeting?.title ?? ''}>
      {meeting && (
        <div className="flex flex-col h-full">
          {/* Tabs */}
          <div className="flex border-b border-gray-200 mb-4 -mt-2">
            <button
              onClick={() => setTab('details')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === 'details' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Детали
            </button>
            <button
              onClick={() => setTab('chat')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === 'chat' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Обсудить с AI
            </button>
          </div>

          {tab === 'details' && (
            <div className="space-y-4 flex-1 overflow-auto">
              <div>
                <input
                  className="w-full text-lg font-semibold border-b border-transparent hover:border-gray-300 focus:border-indigo-400 focus:outline-none px-1 py-0.5"
                  value={form.title ?? ''}
                  onChange={(e) => handleChange('title', e.target.value)}
                  onBlur={() => handleBlur('title')}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-gray-500 mb-1">Дата</div>
                  <input type="date" className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300"
                    value={form.date ?? ''} onChange={(e) => handleChange('date', e.target.value)} onBlur={() => handleBlur('date')} />
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">Проект</div>
                  <select className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300 bg-white"
                    value={form.project_id ?? ''} onChange={(e) => handleProjectChange(e.target.value)}>
                    <option value="">Без проекта</option>
                    {projects.filter((p) => !p.archived).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Delete — visible at top */}
              {onDeleted && (
                <button onClick={async () => { if (confirm('Удалить встречу?')) { await meetingsApi.delete(meeting.id); onDeleted(); onClose(); } }}
                  className="w-full py-2 text-sm text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg border border-red-200 transition-colors">
                  Удалить встречу
                </button>
              )}

              {onTranscribe && (
                <button onClick={onTranscribe} disabled={transcribing}
                  className="w-full py-2.5 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-2">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                  </svg>
                  {transcribing ? 'Транскрибирую...' : 'Загрузить запись встречи'}
                </button>
              )}

              <div>
                <div className="text-xs text-gray-500 mb-1">Содержание / транскрипция</div>
                <textarea className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300 resize-y"
                  rows={12} value={form.summary_raw ?? ''} onChange={(e) => handleChange('summary_raw', e.target.value)}
                  onBlur={() => handleBlur('summary_raw')} placeholder="Текст встречи, заметки, транскрипция..." />
              </div>

              {(meeting as unknown as Record<string, unknown>)['vault_path'] && (
                <div className="text-xs text-gray-400 flex items-center gap-1">
                  <span>Obsidian:</span>
                  <a href={`obsidian://open?vault=ObsidianVault&file=${encodeURIComponent(String((meeting as unknown as Record<string, unknown>)['vault_path']).replace('.md', ''))}`}
                    className="text-indigo-500 hover:text-indigo-700 underline">
                    {String((meeting as unknown as Record<string, unknown>)['vault_path'])}
                  </a>
                </div>
              )}

              <div className="text-xs text-gray-400">Создано: {meeting.created_at}</div>
            </div>
          )}

          {tab === 'chat' && (
            <div className="flex flex-col flex-1 min-h-0">
              {/* Chat messages */}
              <div className="flex-1 overflow-auto space-y-3 mb-3">
                {chatMessages.length === 0 && (
                  <div className="text-sm text-gray-400 space-y-2 p-3 bg-gray-50 rounded-lg">
                    <div className="font-medium text-gray-500">Спроси что угодно о встрече:</div>
                    <div>• «Выдели ключевые договорённости»</div>
                    <div>• «Какие задачи нужно создать?»</div>
                    <div>• «Кратко резюмируй встречу»</div>
                    <div>• «Что обсуждали по срокам?»</div>
                  </div>
                )}
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`text-sm px-3 py-2 rounded-lg ${
                    msg.role === 'user'
                      ? 'bg-indigo-50 text-indigo-800 ml-8'
                      : 'bg-gray-50 text-gray-700 mr-8'
                  }`}>
                    <div className="text-xs font-medium mb-1 text-gray-400">{msg.role === 'user' ? 'Вы' : 'AI'}</div>
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="text-sm text-gray-400 px-3 py-2">Думаю...</div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Chat input */}
              <div className="flex gap-2">
                <input
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-300"
                  placeholder="Спросите о встрече..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                  disabled={chatLoading}
                />
                <button
                  onClick={sendChat}
                  disabled={chatLoading || !chatInput.trim()}
                  className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  →
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </SlidePanel>
  );
}
