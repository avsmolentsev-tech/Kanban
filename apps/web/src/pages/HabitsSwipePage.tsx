import { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api/client';
import { useLangStore } from '../store/lang.store';

interface Habit {
  id: number;
  title: string;
  icon: string;
  color: string;
  frequency: string;
  streak: number;
  remind_time?: string;
}

interface HabitStat {
  id: number;
  dates: string[];
}

const ICON_OPTIONS = [
  { icon: '🧘', label: 'Медитация' }, { icon: '🏋️', label: 'Спорт' }, { icon: '📖', label: 'Чтение' },
  { icon: '🏃', label: 'Бег' }, { icon: '💧', label: 'Вода' }, { icon: '😴', label: 'Сон' },
  { icon: '🥗', label: 'Питание' }, { icon: '✍️', label: 'Письмо' }, { icon: '🎯', label: 'Фокус' },
  { icon: '💊', label: 'Витамины' }, { icon: '🚶', label: 'Прогулка' }, { icon: '🧠', label: 'Учёба' },
];
const COLOR_OPTIONS = ['#6366f1', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];
const FREQ_OPTIONS = [
  { value: 'daily', label: 'Каждый день' },
  { value: '2x_week', label: '2 раза в неделю' },
  { value: '3x_week', label: '3 раза в неделю' },
  { value: 'weekly', label: 'Раз в неделю' },
];

function getToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getLast14Days(): string[] {
  const days: string[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return days;
}

function SwipeHabitCard({ habit, done, logDates, onToggle, onEdit }: {
  habit: Habit; done: boolean; logDates: Set<string>; onToggle: () => void; onEdit: () => void;
}) {
  const [sx, setSx] = useState(0);
  const [startX, setStartX] = useState<number | null>(null);
  const last14 = getLast14Days();
  const today = getToday();

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {!done && sx > 20 && (
        <div className="absolute inset-0 bg-green-500 flex items-center pl-5 text-white font-bold text-sm rounded-2xl"
          style={{ opacity: Math.min(1, sx / 80) }}>✓ Готово</div>
      )}
      <div
        className={`relative border-2 cursor-pointer transition-colors ${
          done ? 'border-green-400 dark:border-green-600 bg-green-50 dark:bg-green-900/20'
            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
        }`}
        style={{ transform: `translateX(${sx}px)`, transition: sx === 0 ? 'transform 0.2s' : 'none', borderRadius: '1rem' }}
        onTouchStart={(e) => { if (!done) setStartX(e.touches[0]!.clientX); }}
        onTouchMove={(e) => { if (startX === null || done) return; const dx = e.touches[0]!.clientX - startX; if (dx > 0) setSx(dx); }}
        onTouchEnd={() => { if (sx > 80 && !done) onToggle(); setSx(0); setStartX(null); }}
      >
        {/* Main row */}
        <div className="flex items-center gap-3 p-4" onClick={() => onToggle()}>
          <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl flex-shrink-0 ${done ? 'bg-green-500 text-white' : ''}`}
            style={!done ? { backgroundColor: habit.color + '22', color: habit.color } : undefined}>
            {done ? '✓' : habit.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className={`font-semibold ${done ? 'line-through text-green-700 dark:text-green-300' : 'text-gray-800 dark:text-gray-100'}`}>
              {habit.title}
            </div>
            <div className="text-[10px] text-gray-400 mt-0.5">
              {FREQ_OPTIONS.find(f => f.value === habit.frequency)?.label ?? habit.frequency}
              {habit.remind_time && ` • ⏰ ${habit.remind_time}`}
            </div>
          </div>
          {habit.streak > 0 && <span className="text-sm text-orange-500 font-bold flex-shrink-0">🔥 {habit.streak}</span>}
          <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="text-gray-400 hover:text-gray-600 text-sm flex-shrink-0 p-1">✏️</button>
        </div>

        {/* Mini calendar — last 14 days */}
        <div className="flex gap-1 px-4 pb-3">
          {last14.map(date => {
            const logged = logDates.has(date);
            const isToday = date === today;
            return (
              <div key={date} title={date}
                className={`w-full h-2 rounded-sm ${
                  logged ? '' : isToday ? 'bg-gray-300 dark:bg-gray-500' : 'bg-gray-100 dark:bg-gray-700'
                }`}
                style={logged ? { backgroundColor: habit.color } : undefined}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function HabitsSwipePage() {
  const { t } = useLangStore();
  const [habits, setHabits] = useState<Habit[]>([]);
  const [doneIds, setDoneIds] = useState<Set<number>>(new Set());
  const [logMap, setLogMap] = useState<Record<number, Set<string>>>({});
  const [showModal, setShowModal] = useState(false);
  const [editHabit, setEditHabit] = useState<Habit | null>(null);
  const [title, setTitle] = useState('');
  const [icon, setIcon] = useState('🧘');
  const [color, setColor] = useState('#6366f1');
  const [freq, setFreq] = useState('daily');
  const [remind, setRemind] = useState('');
  const today = getToday();

  const load = useCallback(async () => {
    try {
      const h = await apiGet<Habit[]>('/habits');
      setHabits(h || []);
      try {
        const s = await apiGet<HabitStat[]>('/habits/stats');
        const done = new Set<number>();
        const lm: Record<number, Set<string>> = {};
        if (s) for (const st of s) {
          if (st.dates) {
            lm[st.id] = new Set(st.dates);
            if (st.dates.includes(today)) done.add(st.id);
          }
        }
        setDoneIds(done);
        setLogMap(lm);
      } catch {}
    } catch {}
  }, [today]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (id: number) => {
    try {
      await apiPost(`/habits/${id}/log`, { date: today });
      setDoneIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
      setLogMap(prev => {
        const n = { ...prev }; const s = new Set(prev[id] || []);
        if (s.has(today)) s.delete(today); else s.add(today);
        n[id] = s; return n;
      });
    } catch {}
  };

  const openCreate = () => {
    setEditHabit(null); setTitle(''); setIcon('🧘'); setColor('#6366f1'); setFreq('daily'); setRemind('');
    setShowModal(true);
  };

  const openEdit = (h: Habit) => {
    setEditHabit(h); setTitle(h.title); setIcon(h.icon); setColor(h.color);
    setFreq(h.frequency || 'daily'); setRemind(h.remind_time || '');
    setShowModal(true);
  };

  const save = async () => {
    if (!title.trim()) return;
    try {
      if (editHabit) {
        await apiPatch(`/habits/${editHabit.id}`, { title: title.trim(), icon, color, frequency: freq, remind_time: remind || null });
      } else {
        await apiPost('/habits', { title: title.trim(), icon, color, frequency: freq, remind_time: remind || null });
      }
      setShowModal(false); load();
    } catch {}
  };

  const remove = async (id: number) => {
    if (!confirm('Удалить привычку?')) return;
    await apiDelete(`/habits/${id}`);
    setShowModal(false); setEditHabit(null); load();
  };

  const doneCount = habits.filter(h => doneIds.has(h.id)).length;

  return (
    <div className="flex flex-col h-full pb-20">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div>
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('🔥 Привычки', '🔥 Habits')}</h1>
          {habits.length > 0 && <div className="text-xs text-gray-400 mt-0.5">{doneCount} из {habits.length} сегодня</div>}
        </div>
        <button onClick={openCreate} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm">+ Новая</button>
      </div>

      {habits.length > 0 && (
        <div className="px-4 mb-3">
          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${(doneCount / habits.length) * 100}%` }} />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto px-4 space-y-2">
        {habits.length === 0 && (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">🔥</div>
            <div className="text-gray-500 dark:text-gray-400">Нет привычек</div>
            <button onClick={openCreate} className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm">+ Добавить</button>
          </div>
        )}

        {habits.map(h => (
          <SwipeHabitCard key={h.id} habit={h} done={doneIds.has(h.id)}
            logDates={logMap[h.id] || new Set()} onToggle={() => toggle(h.id)} onEdit={() => openEdit(h)} />
        ))}

        {doneCount === habits.length && habits.length > 0 && (
          <div className="text-center py-6">
            <div className="text-4xl mb-2">🎉</div>
            <div className="text-sm text-gray-500">Все привычки выполнены!</div>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5 space-y-4">
              <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">{editHabit ? 'Редактировать' : 'Новая привычка'}</h2>

              <input autoFocus className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                placeholder="Название" value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} />

              <div>
                <div className="text-xs text-gray-500 mb-2">Иконка</div>
                <div className="grid grid-cols-3 gap-2">
                  {ICON_OPTIONS.map(({ icon: ic, label }) => (
                    <button key={ic} onClick={() => { setIcon(ic); if (!title) setTitle(label); }}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm ${icon === ic ? 'ring-2 ring-indigo-500 bg-indigo-50 dark:bg-indigo-900/30' : 'bg-gray-50 dark:bg-gray-700'}`}>
                      <span className="text-xl">{ic}</span><span className="text-gray-600 dark:text-gray-300 truncate">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs text-gray-500 mb-2">Цвет</div>
                <div className="flex gap-3">
                  {COLOR_OPTIONS.map(c => (
                    <button key={c} onClick={() => setColor(c)}
                      className={`w-9 h-9 rounded-full ${color === c ? 'ring-2 ring-offset-2 ring-gray-400 dark:ring-offset-gray-800' : ''}`}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs text-gray-500 mb-2">Частота</div>
                <div className="grid grid-cols-2 gap-2">
                  {FREQ_OPTIONS.map(f => (
                    <button key={f.value} onClick={() => setFreq(f.value)}
                      className={`px-3 py-2 rounded-xl text-sm ${freq === f.value ? 'bg-indigo-600 text-white' : 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}>
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs text-gray-500 mb-2">⏰ Напоминание (МСК)</div>
                <input type="time" className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                  value={remind} onChange={e => setRemind(e.target.value)} />
              </div>

              <div className="flex gap-3 pt-2">
                {editHabit && (
                  <button onClick={() => remove(editHabit.id)} className="py-3 px-4 text-sm text-red-500 border border-red-200 rounded-xl">Удалить</button>
                )}
                <button onClick={() => setShowModal(false)} className="flex-1 py-3 rounded-xl border border-gray-200 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-400">{t('Отмена', 'Cancel')}</button>
                <button onClick={save} disabled={!title.trim()} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                  {editHabit ? t('Сохранить', 'Save') : t('Создать', 'Create')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
