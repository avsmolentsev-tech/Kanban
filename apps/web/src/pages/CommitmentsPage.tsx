import { useEffect, useState } from 'react';
import { Handshake, Clock, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { commitmentsApi, type Commitment } from '../api/commitments.api';

const STATUS: Record<string, { label: string; cls: string; Icon: typeof Clock }> = {
  pending: { label: 'ждём', cls: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30', Icon: Clock },
  done: { label: 'выполнено', cls: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30', Icon: CheckCircle2 },
  overdue: { label: 'просрочено', cls: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30', Icon: AlertTriangle },
};

function Row({ c }: { c: Commitment }) {
  const s = STATUS[c.tracker_status] ?? STATUS['pending']!;
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-800 dark:text-gray-100">{c.title}</div>
        <div className="text-[11px] text-gray-400 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
          {c.commitment_owner && <span>👤 {c.commitment_owner}</span>}
          {c.meeting_title && <span className="truncate">🗓 {c.meeting_title}{c.meeting_date ? ` (${c.meeting_date})` : ''}</span>}
          {c.due_date && <span>⏰ до {c.due_date}</span>}
        </div>
      </div>
      <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg flex-shrink-0 ${s.cls}`}>
        <s.Icon size={12} /> {s.label}
      </span>
    </div>
  );
}

export function CommitmentsPage() {
  const [mine, setMine] = useState<Commitment[]>([]);
  const [theirs, setTheirs] = useState<Commitment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    commitmentsApi.list()
      .then(d => { setMine(d.mine); setTheirs(d.theirs); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6 max-w-3xl mx-auto w-full">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
          <Handshake size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Договорённости</h1>
          <p className="text-xs text-gray-400">Кто что кому обещал — из разборов встреч</p>
        </div>
      </div>

      {loading && <div className="mt-8 text-center text-gray-400"><Loader2 className="animate-spin inline" size={18} /> загрузка…</div>}
      {error && <div className="mt-4 text-sm text-red-500">{error}</div>}

      {!loading && !error && (
        <div className="mt-5 space-y-6">
          <section>
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Обещали мне ({theirs.length})</h2>
            {theirs.length === 0 ? <div className="text-xs text-gray-400">Пока нет чужих обязательств из встреч.</div>
              : <div className="space-y-2">{theirs.map(c => <Row key={c.id} c={c} />)}</div>}
          </section>
          <section>
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Мои обязательства ({mine.length})</h2>
            {mine.length === 0 ? <div className="text-xs text-gray-400">Пока нет твоих обязательств из встреч.</div>
              : <div className="space-y-2">{mine.map(c => <Row key={c.id} c={c} />)}</div>}
          </section>
        </div>
      )}
    </div>
  );
}
