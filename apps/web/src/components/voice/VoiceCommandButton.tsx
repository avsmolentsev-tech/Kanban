import { useState, useRef, useEffect } from 'react';
import { apiPost } from '../../api/client';

interface SpeechRecognitionEvent extends Event {
  results: { [index: number]: { [index: number]: { transcript: string }; isFinal?: boolean }; length: number };
  resultIndex: number;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
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

interface VoiceResult {
  type: string;
  success: boolean;
  detail: string;
}

export function VoiceCommandButton({ onActionDone }: { onActionDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [processing, setProcessing] = useState(false);
  const [response, setResponse] = useState('');
  const [results, setResults] = useState<VoiceResult[]>([]);
  const [history, setHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [swipeStart, setSwipeStart] = useState<{ x: number; y: number } | null>(null);
  const [swipeOffset, setSwipeOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const supported = typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  // Airport-style chime — soft, short, pleasant
  const playChime = (freq: number) => {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.6);
    } catch {}
  };
  const playStart = () => playChime(830);  // higher — start
  const playStop = () => playChime(620);   // lower — stop

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
        recognitionRef.current?.stop();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const startRecording = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'ru-RU';

    // Only track what speech recognition adds, don't touch user edits
    let lastInterim = '';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let newFinal = '';
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result && result[0]) {
          if ((result as unknown as { isFinal: boolean }).isFinal) {
            newFinal += result[0].transcript;
          } else {
            interim += result[0].transcript;
          }
        }
      }

      setTranscript((prev) => {
        // Remove previous interim text from the end
        let base = prev;
        if (lastInterim && base.endsWith(lastInterim)) {
          base = base.slice(0, -lastInterim.length);
        }
        // Append finalized + new interim
        lastInterim = interim;
        const addition = newFinal ? newFinal + ' ' : '';
        return base + addition + interim;
      });
    };

    recognition.onerror = () => setRecording(false);
    recognition.onend = () => setRecording(false);

    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
    setResponse('');
    setResults([]);
    playStart();
  };

  const stopRecording = () => {
    recognitionRef.current?.stop();
    setRecording(false);
    playStop();
  };

  const executeCommand = async () => {
    if (!transcript.trim()) return;
    const userText = transcript.trim();
    setProcessing(true);
    setResponse('');
    setResults([]);

    try {
      const data = await apiPost<{ response: string; results: VoiceResult[] }>('/ai/voice-command', {
        text: userText,
        history,
      });
      setResponse(data.response);
      setResults(data.results);
      setTranscript('');
      // Save to history for context
      setHistory(prev => [
        ...prev,
        { role: 'user' as const, content: userText },
        { role: 'assistant' as const, content: data.response },
      ]);
      onActionDone?.();
    } catch (err) {
      setResponse(`Ошибка: ${err instanceof Error ? err.message : 'неизвестная'}`);
    } finally {
      setProcessing(false);
    }
  };

  const clearHistory = () => {
    setHistory([]);
    setResponse('');
    setResults([]);
    setTranscript('');
  };

  if (!supported) return null;

  return (
    <>
      {/* FAB button */}
      <button
        onClick={() => {
          if (open) {
            recognitionRef.current?.stop();
            setOpen(false);
          } else {
            setOpen(true);
            startRecording();
          }
        }}
        className={`fixed bottom-20 right-4 z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all ${
          recording ? 'animate-pulse bg-red-500' : open ? 'bg-gray-700' : 'bg-indigo-600 hover:bg-indigo-700'
        }`}
      >
        {open ? (
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
          </svg>
        )}
      </button>

      {/* Voice panel */}
      {open && (
        <div
          ref={panelRef}
          className="fixed inset-4 md:inset-auto md:bottom-36 md:right-4 md:w-[500px] md:h-[80vh] z-50 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col"
          style={{
            transform: `translate(${swipeOffset.x}px, ${swipeOffset.y}px)`,
            transition: swipeOffset.x === 0 && swipeOffset.y === 0 ? 'transform 0.2s ease-out' : 'none',
            opacity: Math.max(0.5, 1 - Math.max(Math.abs(swipeOffset.x), Math.abs(swipeOffset.y)) / 300),
          }}
          onTouchStart={(e) => {
            const touch = e.touches[0];
            if (touch) setSwipeStart({ x: touch.clientX, y: touch.clientY });
          }}
          onTouchMove={(e) => {
            if (!swipeStart) return;
            const touch = e.touches[0];
            if (!touch) return;
            const dx = touch.clientX - swipeStart.x;
            const dy = touch.clientY - swipeStart.y;
            // Only activate swipe-to-close if motion is primarily horizontal
            // (to not interfere with vertical scroll of chat)
            if (Math.abs(dx) > Math.abs(dy) * 1.5) {
              setSwipeOffset({
                x: dx,
                y: dy * 0.3, // slight vertical follow for Tinder-like feel
              });
            }
          }}
          onTouchEnd={() => {
            if (Math.abs(swipeOffset.x) > 100) {
              recognitionRef.current?.stop();
              setOpen(false);
            }
            setSwipeStart(null);
            setSwipeOffset({ x: 0, y: 0 });
          }}
        >
          {/* Header */}
          <div
            className="px-4 py-3 bg-indigo-600 text-white flex items-center justify-between"
          >
            {/* Mobile drag handle */}
            <div className="absolute top-1.5 left-1/2 -translate-x-1/2 w-10 h-1 bg-indigo-400 rounded-full md:hidden" />
            <div>
              <div className="font-semibold text-sm">Ассистент</div>
              <div className="text-xs text-indigo-200">
                {history.length > 0 ? `Контекст: ${history.length / 2} сообщ.` : 'Задай вопрос или команду'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {history.length > 0 && (
                <button
                  onClick={clearHistory}
                  className="text-xs text-indigo-200 hover:text-white px-2 py-1 rounded border border-indigo-400 hover:border-white transition-colors"
                >
                  Сброс
                </button>
              )}
              <button
                onClick={() => { recognitionRef.current?.stop(); setOpen(false); }}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-indigo-700/50 hover:bg-indigo-800 text-white transition-colors"
                title="Закрыть"
                aria-label="Закрыть"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Scrollable content area — chat history + response */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {/* Hints */}
            {!transcript && !response && !recording && history.length === 0 && (
              <div className="text-sm text-gray-400 dark:text-gray-500 space-y-2 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <div className="font-medium text-gray-500 dark:text-gray-300">Задай любой вопрос или команду:</div>
                <div>• «Создай задачу купить молоко в проект Личные»</div>
                <div>• «Перенеси ревью кода в работу»</div>
                <div>• «Что обсуждали на последней встрече?»</div>
                <div>• «Какие у меня задачи в работе?»</div>
                <div>• «Расскажи про проект V-Cards»</div>
                <div>• «А теперь перенеси её в работу»</div>
              </div>
            )}

            {/* Chat history — takes full scrollable area */}
            {history.length > 0 && (
              <div className="space-y-3">
                {history.map((msg, i) => (
                  <div key={i} className={`p-3 rounded-lg text-sm ${
                    msg.role === 'user'
                      ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-200 ml-6'
                      : 'bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-200 mr-6'
                  }`}>
                    <div className="text-xs font-medium mb-1 text-gray-400 dark:text-gray-500">
                      {msg.role === 'user' ? 'Вы' : 'AI'}
                    </div>
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Current response with action results */}
            {response && history.length === 0 && (
              <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg text-sm">
                <div className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{response}</div>
                {results.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {results.map((r, i) => (
                      <div key={i} className={`text-xs flex items-center gap-1 ${r.success ? 'text-green-600' : 'text-red-500'}`}>
                        <span>{r.success ? '✓' : '✗'}</span>
                        <span>{r.detail}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {processing && (
              <div className="text-sm text-indigo-500 dark:text-indigo-400 px-3 py-2">Думаю...</div>
            )}
          </div>

          {/* Fixed bottom: input + buttons */}
          <div className="border-t border-gray-200 dark:border-gray-700 p-4 space-y-3 bg-white dark:bg-gray-800">
            {/* Mic button + status */}
            <div className="flex items-center gap-3">
              <button
                onClick={recording ? stopRecording : startRecording}
                disabled={processing}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all flex-shrink-0 ${
                  recording
                    ? 'bg-red-500 hover:bg-red-600 animate-pulse shadow-lg shadow-red-200'
                    : 'bg-indigo-600 hover:bg-indigo-700'
                } ${processing ? 'opacity-50' : ''}`}
              >
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                </svg>
              </button>
              <div className="flex-1 text-sm">
                {recording ? (
                  <span className="text-red-500 font-medium">Слушаю... (нажми стоп)</span>
                ) : processing ? (
                  <span className="text-indigo-500 font-medium">Выполняю...</span>
                ) : (
                  <span className="text-gray-500 dark:text-gray-400">Нажми микрофон или пиши</span>
                )}
              </div>
            </div>

            {/* Text input */}
            <textarea
              className="w-full border border-gray-200 dark:border-gray-600 rounded-lg p-2.5 text-sm resize-none focus:outline-none focus:border-indigo-300 bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100"
              rows={3}
              value={transcript}
              onChange={(e) => {
                if (recording) stopRecording();
                setTranscript(e.target.value);
              }}
              placeholder={recording ? 'Говори, текст появится...' : 'Напиши вопрос или команду...'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (transcript.trim() && !processing) {
                    if (recording) stopRecording();
                    executeCommand();
                  }
                }
              }}
            />

            <button
              onClick={() => { if (recording) stopRecording(); executeCommand(); }}
              disabled={processing || !transcript.trim()}
              className="w-full py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {processing ? 'Выполняю...' : recording ? 'Стоп и выполнить' : 'Отправить'}
            </button>

          </div>
        </div>
      )}
    </>
  );
}
