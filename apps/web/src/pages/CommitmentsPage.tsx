import { useEffect, useState } from 'react';
import { Handshake, Clock, CheckCircle2, AlertTriangle, Loader2, Trash2, Pencil, Check, X } from 'lucide-react';
import { commitmentsApi, type Commitment } from '../api/commitments.api';
import { tasksApi } from '../api/tasks.api';

const STATUS: Record<string, { label: string; cls: string; Icon: typeof Clock }> = {
  pending: { label: 'ждём', cls: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30', Icon: Clock },
  done: { label: 'выполнено', cls: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30', Icon: CheckCircle2 },
  overdue: { label: 'просрочено', cls: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30', Icon: AlertTriangle },
};

function Row({ c, onToggle, onDelete, onRename }: {
  c: Commitment;
  onToggle: (c: Commitment) => void;
  onDelete: (c: Commitment) => void;
  onRename: (c: Commitment, title: string) => void;
}) {
  const s = STATUS[c.tracker_status] ?? STATUS['pending']!;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(c.title);
  const done = c.tracker_status === 'done';

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 flex items-start gap-2">
      {/* Done toggle */}
      <button onClick={() => onToggle(c)} title={done ? 'Вернуть в работу' : 'Отметить выполненным'}
        className={`mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 ${done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 dark:border-gray-600 hover:border-emerald-400'}`}>
        {done && <Check size={12} />}
      </button>

      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="flex items-center gap-1">
            <input value={title} onChange={e => setTitle(e.target.value)} autoFocus
              onKeyDown={e => { if (e.key === 'Enter') { onRename(c, title); setEditing(false); } if (e.key === 'Escape') { setTitle(c.title); setEditing(false); } }}
              className="flex-1 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            <button onClick={() => { onRename(c, title); setEditing(false); }} className="text-emerald-600 p-1"><Check size={14} /></button>
            <button onClick={() => { setTitle(c.title); setEditing(false); }} className="text-gray-400 p-1"><X size={14} /></button>
          </div>
        ) : (
          <div className={`text-sm font-medium ${done ? 'text-gray-400 line-through' : 'text-gray-800 dark:text-gray-100'}`}>{c.title}</div>
        )}
        <div className="text-[11px] text-gray-400 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
          {c.commitment_owner && <span>👤 {c.commitment_owner}</span>}
          {c.meeting_title && <span className="truncate">🗓 {c.meeting_title}{c.meeting_date ? ` (${c.meeting_date})` : ''}</span>}
          {c.due_date && <span>⏰ до {c.due_date}</span>}
        </div>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg ${s.cls}`}>
          <s.Icon size={12} /> {s.label}
        </span>
        {!editing && <button onClick={() => setEditing(true)} title="Редактировать" className="text-gray-400 hover:text-indigo-500 p-1"><Pencil size={13} /></button>}
        <button onClick={() => onDelete(c)} title="Удалить" className="text-gray-400 hover:text-red-500 p-1"><Trash2 size={13} /></button>
      </div>
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

  const patchBoth = (id: number, patch: Partial<Commitment>) => {
    setMine(l => l.map(x => x.id === id ? { ...x, ...patch } : x));
    setTheirs(l => l.map(x => x.id === id ? { ...x, ...patch } : x));
  };
  const handleToggle = async (c: Commitment) => {
    const nowDone = c.tracker_status !== 'done';
    patchBoth(c.id, { tracker_status: nowDone ? 'done' : 'pending', status: nowDone ? 'done' : 'backlog' });
    try { await tasksApi.update(c.id, { status: nowDone ? 'done' : 'backlog' }); } catch { /* keep optimistic */ }
  };
  const handleDelete = async (c: Commitment) => {
    setMine(l => l.filter(x => x.id !== c.id));
    setTheirs(l => l.filter(x => x.id !== c.id));
    try { await tasksApi.delete(c.id); } catch { /* ignore */ }
  };
  const handleRename = async (c: Commitment, title: string) => {
    if (!title.trim() || title === c.title) return;
    patchBoth(c.id, { title });
    try { await tasksApi.update(c.id, { title }); } catch { /* ignore */ }
  };

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
              : <div className="space-y-2">{theirs.map(c => <Row key={c.id} c={c} onToggle={handleToggle} onDelete={handleDelete} onRename={handleRename} />)}</div>}
          </section>
          <section>
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Мои обязательства ({mine.length})</h2>
            {mine.length === 0 ? <div className="text-xs text-gray-400">Пока нет твоих обязательств из встреч.</div>
              : <div className="space-y-2">{mine.map(c => <Row key={c.id} c={c} onToggle={handleToggle} onDelete={handleDelete} onRename={handleRename} />)}</div>}
          </section>
        </div>
      )}
    </div>
  );
}
