import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { SlidePanel } from '../ui/SlidePanel';
import { Avatar } from '../ui/Avatar';
import { peopleApi } from '../../api/people.api';
import type { Person, Project, PersonHistory } from '@pis/shared';
import { CheckCircle2, Circle, Clock, Calendar, Handshake } from 'lucide-react';

interface Props {
  person: Person | null;
  projects: Project[];
  onClose: () => void;
  onUpdated: () => void;
  onDeleted?: () => void;
}

export function PersonDetailPanel({ person, projects, onClose, onUpdated, onDeleted }: Props) {
  const [form, setForm] = useState<Partial<Person>>({});
  const [projectIds, setProjectIds] = useState<number[]>([]);
  const [history, setHistory] = useState<PersonHistory | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const navigate = useNavigate();

  const refreshPhoto = async () => {
    if (!person) return;
    setPhotoBusy(true);
    try {
      const { photo_url } = await peopleApi.refreshPhoto(person.id);
      setForm((f) => ({ ...f, photo_url }));
      onUpdated();
    } catch {
      alert('Не удалось получить фото — профиль закрыт или @username не задан.');
    } finally {
      setPhotoBusy(false);
    }
  };

  useEffect(() => {
    if (person) {
      setForm({ ...person });
      setProjectIds(person.project_ids ?? (person.project_id != null ? [person.project_id] : []));
      peopleApi.history(person.id).then(setHistory).catch(() => setHistory(null));
    } else {
      setHistory(null);
    }
  }, [person]);

  const save = async (field: string, value: string | number | null) => {
    if (!person) return;
    await peopleApi.update(person.id, { [field]: value });
    onUpdated();
  };

  const handleChange = (field: keyof Person, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  const handleBlur = (field: string) => {
    if (!person) return;
    const newVal = (form as unknown as Record<string, unknown>)[field];
    const oldVal = (person as unknown as Record<string, unknown>)[field];
    if (newVal !== oldVal) save(field, newVal as string);
  };

  const toggleProject = async (id: number) => {
    if (!person) return;
    const next = projectIds.includes(id) ? projectIds.filter(x => x !== id) : [...projectIds, id];
    setProjectIds(next);
    await peopleApi.update(person.id, { project_ids: next });
    onUpdated();
  };

  const activeProjects = projects.filter(p => !p.archived);

  return (
    <SlidePanel open={!!person} onClose={onClose} title={person?.name ?? ''}>
      {person && (
        <div className="space-y-4">
          <div className="flex items-center gap-4 mb-4">
            <div className="flex flex-col items-center gap-1">
              <Avatar name={form.name ?? person.name} size="lg" url={form.photo_url}
                onClick={form.photo_url ? () => setLightbox(true) : undefined} />
              {(form.telegram ?? person.telegram) && (
                <button onClick={refreshPhoto} disabled={photoBusy} className="text-[10px] text-indigo-500 hover:underline disabled:opacity-50" title="Подтянуть фото из Telegram">
                  {photoBusy ? '…' : 'фото из TG'}
                </button>
              )}
            </div>
            <input className="flex-1 text-lg font-semibold border-b border-transparent hover:border-gray-300 focus:border-indigo-400 focus:outline-none px-1 py-0.5"
              value={form.name ?? ''} onChange={(e) => handleChange('name', e.target.value)} onBlur={() => handleBlur('name')} />
          </div>

          {lightbox && form.photo_url && (
            <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-6" onClick={() => setLightbox(false)}>
              <img src={form.photo_url} alt={form.name ?? ''} className="max-w-full max-h-full rounded-2xl object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
              <button onClick={() => setLightbox(false)} className="absolute top-4 right-4 text-white/80 hover:text-white text-2xl">✕</button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Компания" value={form.company ?? ''} onChange={(v) => handleChange('company', v)} onBlur={() => handleBlur('company')} />
            <Field label="Роль" value={form.role ?? ''} onChange={(v) => handleChange('role', v)} onBlur={() => handleBlur('role')} />
          </div>

          <div className="grid grid-cols-1 gap-3">
            <Field label="Email" value={form.email ?? ''} onChange={(v) => handleChange('email', v)} onBlur={() => handleBlur('email')} />
            <Field label="Telegram" value={form.telegram ?? ''} onChange={(v) => handleChange('telegram', v)} onBlur={() => handleBlur('telegram')} />
            <Field label="Телефон" value={form.phone ?? ''} onChange={(v) => handleChange('phone', v)} onBlur={() => handleBlur('phone')} />
          </div>

          {activeProjects.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-1.5">Проекты</div>
              <div className="flex flex-wrap gap-2">
                {activeProjects.map(p => {
                  const active = projectIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleProject(p.id)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors ${active ? 'border-transparent text-white' : 'border-gray-200 text-gray-600 bg-white hover:border-gray-300'}`}
                      style={active ? { backgroundColor: p.color, borderColor: p.color } : {}}
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: active ? 'rgba(255,255,255,0.7)' : p.color }} />
                      {p.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <div className="text-xs text-gray-500 mb-1">Заметки</div>
            <textarea className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300 resize-none"
              rows={4} value={form.notes ?? ''} onChange={(e) => handleChange('notes', e.target.value)} onBlur={() => handleBlur('notes')} />
          </div>

          {/* Linked entities */}
          {history && (history.tasks.length > 0 || history.meetings.length > 0 || history.agreements.length > 0) && (
            <div className="space-y-3 pt-2 border-t border-gray-100 dark:border-gray-700">
              {history.tasks.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 flex items-center gap-1">
                    <CheckCircle2 size={12} /> Задачи ({history.tasks.length})
                  </div>
                  <div className="space-y-1">
                    {history.tasks.map(t => (
                      <button key={t.id} onClick={() => { onClose(); navigate(`/?open=task-${t.id}`); }}
                        className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group">
                        {t.status === 'done' ? <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" /> :
                         t.status === 'in_progress' ? <Clock size={14} className="text-blue-500 flex-shrink-0" /> :
                         <Circle size={14} className="text-gray-300 flex-shrink-0" />}
                        <span className={`text-sm truncate ${t.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-700 dark:text-gray-200'}`}>{t.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {history.meetings.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 flex items-center gap-1">
                    <Calendar size={12} /> Встречи ({history.meetings.length})
                  </div>
                  <div className="space-y-1">
                    {history.meetings.map(m => (
                      <button key={m.id} onClick={() => { onClose(); navigate(`/meetings?open=meeting-${m.id}`); }}
                        className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                        <span className="text-xs text-gray-400 flex-shrink-0 w-20">{m.date}</span>
                        <span className="text-sm text-gray-700 dark:text-gray-200 truncate">{m.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {history.agreements.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 flex items-center gap-1">
                    <Handshake size={12} /> Договорённости ({history.agreements.length})
                  </div>
                  <div className="space-y-1">
                    {history.agreements.map(a => (
                      <div key={a.id} className="flex items-start gap-2 px-2 py-1.5">
                        {a.status === 'done' ? <CheckCircle2 size={14} className="text-green-500 flex-shrink-0 mt-0.5" /> :
                         <Circle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />}
                        <div className="min-w-0">
                          <span className={`text-sm ${a.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-700 dark:text-gray-200'}`}>{a.description}</span>
                          {a.due_date && <span className="text-xs text-gray-400 ml-2">до {a.due_date}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="text-xs text-gray-400 pt-2">Создан: {person.created_at}</div>

          {onDeleted && (
            <button
              onClick={async () => {
                if (confirm(`Удалить ${person.name}?`)) {
                  await peopleApi.delete(person.id);
                  onDeleted();
                  onClose();
                }
              }}
              className="w-full py-2 text-sm text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg border border-red-200 transition-colors"
            >
              Удалить
            </button>
          )}
        </div>
      )}
    </SlidePanel>
  );
}

function Field({ label, value, onChange, onBlur }: { label: string; value: string; onChange: (v: string) => void; onBlur: () => void }) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <input className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300"
        value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
    </div>
  );
}
