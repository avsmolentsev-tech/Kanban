import { useEffect, useState } from 'react';
import { Sparkles, Send, Loader2, AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
import { advisorsApi, type Advisor, type AdvisorAnalysis } from '../../api/advisors.api';

function initials(name: string): string {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

/** Advisory Board panel scoped to a meeting — pulls the meeting content server-side. */
export function MeetingCouncil({ meetingId }: { meetingId: number }) {
  const [advisors, setAdvisors] = useState<Advisor[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [analyses, setAnalyses] = useState<AdvisorAnalysis[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [chatAdvisor, setChatAdvisor] = useState<Advisor | null>(null);
  const [chatMsgs, setChatMsgs] = useState<Array<{ role: 'user' | 'advisor'; content: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSession, setChatSession] = useState<number | undefined>(undefined);
  const [chatBusy, setChatBusy] = useState(false);

  useEffect(() => { advisorsApi.list().then(setAdvisors).catch(e => setError(e.message)); }, []);

  const toggle = (id: number) => setSelected(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });

  const run = async () => {
    if (selected.size === 0) return;
    setLoading(true); setError(''); setAnalyses([]);
    try {
      const res = await advisorsApi.analyze([...selected], { meeting_id: meetingId });
      setAnalyses(res.analyses);
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка разбора'); }
    finally { setLoading(false); }
  };

  const openChat = (a: Advisor) => { setChatAdvisor(a); setChatMsgs([]); setChatSession(undefined); setChatInput(''); };

  const sendChat = async () => {
    if (!chatAdvisor || !chatInput.trim()) return;
    const msg = chatInput.trim();
    setChatMsgs(m => [...m, { role: 'user', content: msg }]); setChatInput(''); setChatBusy(true);
    try {
      const res = await advisorsApi.chat(chatAdvisor.id, msg, { session_id: chatSession, meeting_id: meetingId });
      setChatSession(res.session_id);
      setChatMsgs(m => [...m, { role: 'advisor', content: res.reply }]);
    } catch (e) { setChatMsgs(m => [...m, { role: 'advisor', content: `⚠️ ${e instanceof Error ? e.message : 'ошибка'}` }]); }
    finally { setChatBusy(false); }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">Выбери персон совета — они разберут эту встречу.</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {advisors.map(a => {
          const on = selected.has(a.id);
          return (
            <button key={a.id} onClick={() => toggle(a.id)}
              className={`flex items-center gap-2 text-left rounded-xl border p-2 transition-all ${
                on ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 ring-1 ring-indigo-500' : 'border-gray-200 dark:border-gray-700 hover:border-indigo-300'
              }`}>
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">{initials(a.name)}</div>
              <div className="min-w-0">
                <div className="text-[12px] font-semibold text-gray-800 dark:text-gray-100 truncate">{a.name}</div>
                <div className="text-[9px] text-gray-400 truncate">{a.domain}</div>
              </div>
            </button>
          );
        })}
      </div>

      <button onClick={run} disabled={loading || selected.size === 0}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium disabled:opacity-40 hover:bg-indigo-700">
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
        Разбор советом ({selected.size})
      </button>

      {error && <div className="text-sm text-red-500">{error}</div>}

      <div className="space-y-3">
        {analyses.map(an => (
          <div key={an.advisor_id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-[10px] font-bold">{initials(an.name)}</div>
                <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">{an.name}</div>
              </div>
              {advisors.find(a => a.id === an.advisor_id) && (
                <button onClick={() => openChat(advisors.find(a => a.id === an.advisor_id)!)} className="text-xs px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200">Обсудить</button>
              )}
            </div>
            {an.error ? <div className="mt-2 text-sm text-red-500">{an.error}</div> : (
              <div className="mt-2 space-y-2 text-sm text-gray-700 dark:text-gray-200">
                {an.opinion && <p className="whitespace-pre-wrap">{an.opinion}</p>}
                {an.risks && an.risks.length > 0 && (
                  <div><div className="flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400 mb-1"><AlertTriangle size={13} /> Риски</div>
                    <ul className="list-disc list-inside space-y-0.5">{an.risks.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
                )}
                {an.would_do && (
                  <div><div className="flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 mb-1"><CheckCircle2 size={13} /> Что бы я сделал</div>
                    <p className="whitespace-pre-wrap">{an.would_do}</p></div>
                )}
                {an.questions && an.questions.length > 0 && (
                  <div><div className="flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 mb-1"><HelpCircle size={13} /> Вопросы к тебе</div>
                    <ul className="list-disc list-inside space-y-0.5">{an.questions.map((q, i) => <li key={i}>{q}</li>)}</ul></div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {chatAdvisor && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40" onClick={() => setChatAdvisor(null)}>
          <div className="bg-white dark:bg-gray-800 w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 p-3 border-b border-gray-200 dark:border-gray-700">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-[10px] font-bold">{initials(chatAdvisor.name)}</div>
              <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">{chatAdvisor.name}</div>
              <button onClick={() => setChatAdvisor(null)} className="ml-auto text-gray-400 hover:text-gray-600 text-sm">✕</button>
            </div>
            <div className="flex-1 overflow-auto p-3 space-y-2">
              {chatMsgs.length === 0 && <div className="text-xs text-gray-400 text-center py-6">{chatAdvisor.name} видит эту встречу — задай вопрос.</div>}
              {chatMsgs.map((m, i) => (
                <div key={i} className={`text-sm rounded-xl px-3 py-2 max-w-[85%] ${m.role === 'user' ? 'ml-auto bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100'}`}>
                  <span className="whitespace-pre-wrap">{m.content}</span>
                </div>
              ))}
              {chatBusy && <div className="text-xs text-gray-400"><Loader2 size={14} className="animate-spin inline" /> думает…</div>}
            </div>
            <div className="p-3 border-t border-gray-200 dark:border-gray-700 flex gap-2">
              <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendChat()}
                placeholder="Сообщение…" className="flex-1 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <button onClick={sendChat} disabled={chatBusy || !chatInput.trim()} className="px-3 rounded-xl bg-indigo-600 text-white disabled:opacity-40"><Send size={16} /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
