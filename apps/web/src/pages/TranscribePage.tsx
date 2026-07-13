import { useEffect, useRef, useState } from 'react';
import { Mic, Upload, Loader2, Copy, Download, Check, Trash2 } from 'lucide-react';
import { transcribeApi, type TranscriptionJob } from '../api/transcribe.api';

export function TranscribePage() {
  const [jobs, setJobs] = useState<TranscriptionJob[]>([]);
  const [active, setActive] = useState<TranscriptionJob | null>(null);
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadList = () => { transcribeApi.list().then(setJobs).catch(() => {}); };
  useEffect(() => { loadList(); return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, []);

  const poll = (id: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const job = await transcribeApi.get(id);
        setActive(job);
        if (job.status !== 'processing') { if (pollRef.current) clearInterval(pollRef.current); loadList(); }
      } catch { /* keep polling */ }
    }, 3000);
  };

  const onFile = async (file: File) => {
    setUploading(true); setActive(null);
    try {
      const { id } = await transcribeApi.upload(file);
      const job = await transcribeApi.get(id);
      setActive(job); loadList(); poll(id);
    } catch (e) {
      alert('Не удалось загрузить файл: ' + (e instanceof Error ? e.message : ''));
    } finally { setUploading(false); }
  };

  const openJob = async (id: number) => {
    const job = await transcribeApi.get(id);
    setActive(job);
    if (job.status === 'processing') poll(id);
  };

  const copy = () => { if (active?.text) { navigator.clipboard.writeText(active.text); setCopied(true); setTimeout(() => setCopied(false), 1500); } };
  const download = () => {
    if (!active?.text) return;
    const blob = new Blob([active.text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = (active.filename || 'transcript').replace(/\.[^.]+$/, '') + '.txt'; a.click();
  };
  const remove = async (id: number) => { await transcribeApi.delete(id); if (active?.id === id) setActive(null); loadList(); };
  const summarize = async () => {
    if (!active) return;
    setSummarizing(true);
    try { const { summary } = await transcribeApi.summarize(active.id); setActive(a => a ? { ...a, summary } : a); }
    catch { alert('Не удалось сделать резюме.'); }
    finally { setSummarizing(false); }
  };

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6 max-w-3xl mx-auto w-full">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
          <Mic size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Транскрипция</h1>
          <p className="text-xs text-gray-400">Расшифровка записи в текст — без создания встречи</p>
        </div>
      </div>

      <button onClick={() => fileRef.current?.click()} disabled={uploading}
        className="mt-5 w-full flex items-center justify-center gap-2 py-8 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-indigo-400 hover:text-indigo-500 transition-colors disabled:opacity-50">
        {uploading ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
        {uploading ? 'Загрузка…' : 'Выбрать аудио или видео'}
      </button>
      <input ref={fileRef} type="file" accept="audio/*,video/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
      <p className="text-[11px] text-gray-400 mt-2 text-center">Также можно прислать файл боту @MyBestKanban_bot командой «транскрибация»</p>

      {/* Active result */}
      {active && (
        <div className="mt-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{active.filename}</div>
            {active.status === 'done' && (
              <div className="flex items-center gap-1 flex-shrink-0">
                {!active.summary && (
                  <button onClick={summarize} disabled={summarizing} className="text-xs px-2 py-1 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 inline-flex items-center gap-1 font-medium disabled:opacity-50">{summarizing ? <Loader2 size={13} className="animate-spin" /> : '✨'} Резюме</button>
                )}
                <button onClick={copy} className="text-xs px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 inline-flex items-center gap-1">{copied ? <Check size={13} /> : <Copy size={13} />} Копировать</button>
                <button onClick={download} className="text-xs px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 inline-flex items-center gap-1"><Download size={13} /> .txt</button>
              </div>
            )}
          </div>
          {active.status === 'processing' && <div className="text-sm text-gray-400 flex items-center gap-2 py-3"><Loader2 size={16} className="animate-spin" /> Расшифровываю… (можно уйти со страницы — сохранится в списке)</div>}
          {active.status === 'error' && <div className="text-sm text-red-500">Ошибка: {active.error}</div>}
          {active.summary && (
            <div className="mb-3 p-3 rounded-xl bg-indigo-50/60 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800">
              <div className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 mb-1">✨ Резюме</div>
              <div className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">{active.summary}</div>
            </div>
          )}
          {active.status === 'done' && <div className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap leading-relaxed max-h-[50vh] overflow-auto">{active.text}</div>}
        </div>
      )}

      {/* Recent */}
      {jobs.length > 0 && (
        <div className="mt-6">
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Недавние</div>
          <div className="space-y-1.5">
            {jobs.map(j => (
              <div key={j.id} className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2">
                <button onClick={() => openJob(j.id)} className="flex-1 min-w-0 text-left">
                  <div className="text-sm text-gray-800 dark:text-gray-100 truncate">{j.filename}</div>
                  <div className="text-[11px] text-gray-400">{j.status === 'done' ? 'готово' : j.status === 'error' ? 'ошибка' : 'обрабатывается…'} · {j.created_at?.slice(0, 10)}</div>
                </button>
                <button onClick={() => remove(j.id)} className="text-gray-400 hover:text-red-500 p-1"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
