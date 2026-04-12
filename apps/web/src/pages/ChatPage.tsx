import { useState, useRef, useEffect } from 'react';
import { apiPost, apiClient } from '../api/client';
import { useLangStore } from '../store/lang.store';
import { MessageCircle, Copy, Check } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  files?: Array<{ name: string; size: number }>;
}

// Speech Recognition types
interface SpeechRecognitionEvent extends Event {
  results: { [index: number]: { [index: number]: { transcript: string }; isFinal?: boolean }; length: number };
  resultIndex: number;
}
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean; interimResults: boolean; lang: string;
  start(): void; stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}
declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
}

const SUGGESTIONS_RU = [
  'Что обсуждали на последней встрече?',
  'Какие задачи в работе?',
  'Сделай бандл по всем проектам',
  'Покажи задачи на сегодня',
  'Какие цели активны?',
];

const SUGGESTIONS_EN = [
  'What did we discuss at the last meeting?',
  'What tasks are in progress?',
  'Create a bundle for all projects',
  'Show today\'s tasks',
  'What goals are active?',
];

function CopyButton({ text, side }: { text: string; side: 'left' | 'right' }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };
  return (
    <button onClick={copy}
      className={`absolute top-1 ${side === 'left' ? '-left-8' : '-right-8'} p-1 rounded-lg opacity-0 group-hover:opacity-100 active:opacity-100 transition-opacity text-gray-400 hover:text-gray-600 dark:hover:text-gray-300`}>
      {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
    </button>
  );
}

export function ChatPage() {
  const { t } = useLangStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const hasSpeech = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: ChatMessage = { role: 'user', content: text.trim() };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput('');
    setLoading(true);

    try {
      const res = await apiPost<{ response: string; results?: Array<{ detail: string }> }>('/ai/voice-command', {
        text: text.trim(),
        history: history.slice(-20).map(m => ({ role: m.role, content: m.content })),
      });
      const reply = res.response + (res.results && res.results.length > 0 ? '\n\n' + res.results.map(r => r.detail).join('\n') : '');
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (e: unknown) {
      setMessages(prev => [...prev, { role: 'assistant', content: `${t('Ошибка:', 'Error:')} ${e instanceof Error ? e.message : 'unknown'}` }]);
    } finally { setLoading(false); }
  };

  const handleFile = async (file: File) => {
    const userMsg: ChatMessage = { role: 'user', content: `📎 ${file.name}`, files: [{ name: file.name, size: file.size }] };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const form = new FormData();
      form.append('file', file);
      const res = await apiClient.post('/ingest', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      const data = res.data?.data;
      const reply = data ? `${data.detected_type}: ${data.summary}` : t('Файл обработан', 'File processed');
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (e: unknown) {
      setMessages(prev => [...prev, { role: 'assistant', content: `${t('Ошибка:', 'Error:')} ${e instanceof Error ? e.message : 'unknown'}` }]);
    } finally { setLoading(false); }
  };

  const toggleMic = () => {
    if (recording) {
      recognitionRef.current?.stop();
      setRecording(false);
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'ru-RU';

    let finalText = '';
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result && result[0]) {
          if ((result as unknown as { isFinal: boolean }).isFinal) {
            finalText += result[0].transcript + ' ';
          } else {
            interim += result[0].transcript;
          }
        }
      }
      setInput(finalText + interim);
    };
    recognition.onerror = () => setRecording(false);
    recognition.onend = () => setRecording(false);
    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
  };

  return (
    <div className="flex flex-col h-full pb-16 md:pb-0">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-2 border-b border-gray-200 dark:border-gray-700">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
          <MessageCircle size={20} className="text-white" />
        </div>
        <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('Чат с ассистентом', 'AI Assistant')}</h1>
      </div>
      {/* Messages */}
      <div className="flex-1 overflow-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full gap-6">
            <div className="text-center">
              <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-2">{t('Чат с ассистентом', 'AI Assistant')}</h2>
              <p className="text-gray-500 dark:text-gray-400 text-sm">{t('Задайте вопрос или прикрепите файл', 'Ask a question or attach a file')}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 max-w-lg">
              {SUGGESTIONS_RU.map((ru, i) => (
                <button key={ru} onClick={() => send(t(ru, SUGGESTIONS_EN[i] ?? ru))}
                  className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:border-indigo-300 transition-colors">
                  {t(ru, SUGGESTIONS_EN[i] ?? ru)}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} group`}>
            <div className="relative max-w-[80%]">
              <div className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 border border-gray-200 dark:border-gray-700'
              }`}>
                {msg.content}
              </div>
              <CopyButton text={msg.content} side={msg.role === 'user' ? 'left' : 'right'} />
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl px-4 py-2.5 text-sm text-gray-500 animate-pulse">
              {t('Думаю...', 'Thinking...')}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
        <div className="flex items-end gap-2 max-w-3xl mx-auto">
          {/* File attach */}
          <button onClick={() => fileRef.current?.click()}
            className="px-3 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-lg flex-shrink-0"
            title={t('Прикрепить файл', 'Attach file')}>
            📎
          </button>
          <input ref={fileRef} type="file" className="hidden" onChange={e => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = '';
          }} />

          {/* Text input */}
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder={recording ? t('Говори...', 'Speaking...') : t('Сообщение...', 'Message...')}
            rows={1}
            className={`flex-1 resize-none rounded-xl border bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
              recording ? 'border-red-400 bg-red-50 dark:bg-red-900/20' : 'border-gray-300 dark:border-gray-600'
            }`}
          />

          {/* Send */}
          <button onClick={() => { if (recording) { recognitionRef.current?.stop(); setRecording(false); } send(input); }}
            disabled={!input.trim() || loading}
            className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors flex-shrink-0">
            →
          </button>

          {/* Mic */}
          {hasSpeech && (
            <button onClick={toggleMic}
              className={`px-3 py-2.5 rounded-xl border transition-colors text-lg flex-shrink-0 ${
                recording
                  ? 'bg-red-500 border-red-500 text-white animate-pulse'
                  : 'border-gray-300 dark:border-gray-600 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
              title={recording ? t('Остановить', 'Stop') : t('Голосовой ввод', 'Voice input')}>
              🎤
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
