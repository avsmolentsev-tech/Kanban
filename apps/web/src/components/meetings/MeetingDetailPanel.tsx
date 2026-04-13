import { useState, useEffect, useRef } from 'react';
import { SlidePanel } from '../ui/SlidePanel';
import { meetingsApi } from '../../api/meetings.api';
import { apiPost } from '../../api/client';
import type { Meeting, Project } from '@pis/shared';
import { useLangStore } from '../../store/lang.store';

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
  const { t } = useLangStore();
  const [form, setForm] = useState<Partial<Meeting>>({});
  const [projectIds, setProjectIds] = useState<number[]>([]);
  const [tab, setTab] = useState<'details' | 'chat'>('details');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [sendFormat, setSendFormat] = useState<'md' | 'pdf' | 'docx'>('pdf');
  const [sendingKind, setSendingKind] = useState<'summary' | 'full' | null>(null);

  useEffect(() => {
    if (meeting) {
      setForm({ ...meeting });
      const ids = (meeting as unknown as Record<string, unknown>)['project_ids'] as number[] | undefined;
      setProjectIds(ids ?? (meeting.project_id != null ? [meeting.project_id] : []));
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

  const sendToTelegram = async (kind: 'summary' | 'full') => {
    if (!meeting) return;
    setSendingKind(kind);
    try {
      await apiPost(`/meetings/${meeting.id}/send-to-telegram`, { type: kind, format: sendFormat });
      alert(t(`✅ ${kind === 'summary' ? 'Резюме' : 'Полная транскрипция'} отправлена в Telegram`, `✅ ${kind === 'summary' ? 'Summary' : 'Full transcript'} sent to Telegram`));
    } catch (err) {
      alert(t('Ошибка: ', 'Error: ') + (err instanceof Error ? err.message : 'unknown'));
    } finally {
      setSendingKind(null);
    }
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

      const context = t(
        `Контекст встречи:\nНазвание: ${meeting.title}\nДата: ${meeting.date}\nПроект: ${projectName || 'не указан'}\n\nСодержание встречи:\n${form.summary_raw || '(пусто)'}\n\nОтвечай на русском. Если пользователь просит выделить задачи, договорённости, ключевые моменты — делай это по содержанию встречи.`,
        `Meeting context:\nTitle: ${meeting.title}\nDate: ${meeting.date}\nProject: ${projectName || 'not specified'}\n\nMeeting content:\n${form.summary_raw || '(empty)'}\n\nReply in English. If the user asks to highlight tasks, agreements, or key points — extract them from the meeting content.`
      );

      const data = await apiPost<{ reply: string }>('/ai/chat', {
        messages: [...chatMessages, userMsg],
        context,
      });
      setChatMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      setChatMessages((prev) => [...prev, { role: 'assistant', content: t(`Ошибка: ${err instanceof Error ? err.message : 'unknown'}`, `Error: ${err instanceof Error ? err.message : 'unknown'}`) }]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <SlidePanel open={!!meeting} onClose={onClose} title={meeting?.title ?? ''} expandable>
      {meeting && (
        <div className="flex flex-col h-full">
          {/* Tabs */}
          <div className="flex border-b border-gray-200 dark:border-gray-700 mb-4 -mt-2">
            <button
              onClick={() => setTab('details')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === 'details' ? 'border-indigo-600 text-indigo-500 dark:text-indigo-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {t('Детали', 'Details')}
            </button>
            <button
              onClick={() => setTab('chat')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === 'chat' ? 'border-indigo-600 text-indigo-500 dark:text-indigo-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {t('Обсудить с AI', 'Discuss with AI')}
            </button>
          </div>

          {tab === 'details' && (
            <div className="space-y-4 flex-1 overflow-auto">
              <div>
                <input
                  className="w-full text-lg font-semibold bg-transparent text-gray-900 dark:text-gray-100 border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-indigo-400 focus:outline-none px-1 py-0.5"
                  value={form.title ?? ''}
                  onChange={(e) => handleChange('title', e.target.value)}
                  onBlur={() => handleBlur('title')}
                />
              </div>

              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('Дата', 'Date')}</div>
                <input type="date" className="w-full text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300 dark:focus:border-indigo-500"
                  value={form.date ?? ''} onChange={(e) => handleChange('date', e.target.value)} onBlur={() => handleBlur('date')} />
              </div>

              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">{t('Проекты (можно несколько)', 'Projects (multiple allowed)')}</div>
                <div className="flex flex-wrap gap-2">
                  {projects.filter((p) => !p.archived).map((p) => {
                    const active = projectIds.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={async () => {
                          const next = active ? projectIds.filter(x => x !== p.id) : [...projectIds, p.id];
                          setProjectIds(next); // immediate UI update
                          try {
                            await meetingsApi.update(meeting.id, { project_ids: next });
                            onUpdated();
                          } catch (err) {
                            // Revert on error
                            setProjectIds(projectIds);
                            alert(t('Ошибка: ', 'Error: ') + (err instanceof Error ? err.message : 'unknown'));
                          }
                        }}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors ${active ? 'border-transparent text-white' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'}`}
                        style={active ? { backgroundColor: p.color, borderColor: p.color } : {}}
                      >
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: active ? 'rgba(255,255,255,0.7)' : p.color }} />
                        {p.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {onTranscribe && (
                <button onClick={onTranscribe} disabled={transcribing}
                  className="w-full py-2.5 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-2">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                  </svg>
                  {transcribing ? t('Транскрибирую...', 'Transcribing...') : t('Загрузить запись встречи', 'Upload meeting recording')}
                </button>
              )}

              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('Содержание / транскрипция', 'Content / transcription')}</div>
                <textarea className="w-full text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300 dark:focus:border-indigo-500 resize-y placeholder-gray-400 dark:placeholder-gray-500"
                  rows={12} value={form.summary_raw ?? ''} onChange={(e) => handleChange('summary_raw', e.target.value)}
                  onBlur={() => handleBlur('summary_raw')} placeholder={t('Текст встречи, заметки, транскрипция...', 'Meeting text, notes, transcription...')} />
              </div>

              {!!(meeting as unknown as Record<string, unknown>)['vault_path'] && (
                <div className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
                  <span>Obsidian:</span>
                  <a href={`obsidian://open?vault=ObsidianVault&file=${encodeURIComponent(String((meeting as unknown as Record<string, unknown>)['vault_path']).replace('.md', ''))}`}
                    className="text-indigo-500 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 underline">
                    {String((meeting as unknown as Record<string, unknown>)['vault_path'])}
                  </a>
                </div>
              )}

              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">{t('Отправить в Telegram', 'Send to Telegram')}</div>
                <div className="flex gap-1.5 mb-2">
                  {(['md', 'pdf', 'docx'] as const).map((f) => (
                    <button key={f} type="button" onClick={() => setSendFormat(f)}
                      className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                        sendFormat === f
                          ? 'bg-indigo-600 border-indigo-600 text-white'
                          : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                      }`}>{f.toUpperCase()}</button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => sendToTelegram('summary')} disabled={sendingKind !== null}
                    className="flex-1 py-2 text-xs text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg border border-indigo-200 dark:border-indigo-800 transition-colors disabled:opacity-50">
                    {sendingKind === 'summary' ? t('Отправляю...', 'Sending...') : t('📄 Резюме', '📄 Summary')}
                  </button>
                  <button onClick={() => sendToTelegram('full')} disabled={sendingKind !== null}
                    className="flex-1 py-2 text-xs text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg border border-indigo-200 dark:border-indigo-800 transition-colors disabled:opacity-50">
                    {sendingKind === 'full' ? t('Отправляю...', 'Sending...') : t('📜 Полная транскрипция', '📜 Full transcript')}
                  </button>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer select-none">
                <input type="checkbox"
                  checked={((meeting as unknown as Record<string, unknown>)['sync_vault'] as number | undefined) !== 0}
                  onChange={async (e) => {
                    const val = e.target.checked;
                    await meetingsApi.update(meeting.id, { sync_vault: val } as unknown as Parameters<typeof meetingsApi.update>[1]);
                    onUpdated();
                  }}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500" />
                <span>{t('Синхронизировать с Obsidian', 'Sync with Obsidian')}</span>
              </label>

              <div className="text-xs text-gray-400 dark:text-gray-500">{t('Создано: ', 'Created: ')}{meeting.created_at}</div>

              {onDeleted && (
                <button onClick={async () => { if (confirm(t('Удалить встречу?', 'Delete meeting?'))) { await meetingsApi.delete(meeting.id); onDeleted(); onClose(); } }}
                  className="w-full py-2 text-sm text-red-500 dark:text-red-400 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-900/40 transition-colors">
                  {t('Удалить встречу', 'Delete meeting')}
                </button>
              )}
            </div>
          )}

          {tab === 'chat' && (
            <div className="flex flex-col flex-1 min-h-0">
              {/* Chat messages */}
              <div className="flex-1 overflow-auto space-y-3 mb-3">
                {chatMessages.length === 0 && (
                  <div className="text-sm text-gray-500 dark:text-gray-400 space-y-2 p-3 bg-gray-50 dark:bg-gray-800/60 rounded-lg">
                    <div className="font-medium text-gray-600 dark:text-gray-300">{t('Спроси что угодно о встрече:', 'Ask anything about the meeting:')}</div>
                    <div>• {t('«Выдели ключевые договорённости»', '"Highlight key agreements"')}</div>
                    <div>• {t('«Какие задачи нужно создать?»', '"What tasks should be created?"')}</div>
                    <div>• {t('«Кратко резюмируй встречу»', '"Briefly summarize the meeting"')}</div>
                    <div>• {t('«Что обсуждали по срокам?»', '"What was discussed about deadlines?"')}</div>
                  </div>
                )}
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`text-sm px-3 py-2 rounded-lg ${
                    msg.role === 'user'
                      ? 'bg-indigo-50 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-200 ml-8'
                      : 'bg-gray-50 text-gray-700 dark:bg-gray-800/60 dark:text-gray-200 mr-8'
                  }`}>
                    <div className="text-xs font-medium mb-1 text-gray-400 dark:text-gray-500">{msg.role === 'user' ? t('Вы', 'You') : 'AI'}</div>
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="text-sm text-gray-400 dark:text-gray-500 px-3 py-2">{t('Думаю...', 'Thinking...')}</div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Chat input */}
              <div className="flex gap-2">
                <input
                  className="flex-1 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-300 dark:focus:border-indigo-500 placeholder-gray-400 dark:placeholder-gray-500"
                  placeholder={t('Спросите о встрече...', 'Ask about the meeting...')}
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
