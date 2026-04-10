import { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost, apiDelete } from '../api/client';

interface Habit {
  id: number;
  title: string;
  icon: string;
  color: string;
  streak: number;
}

interface HabitStat {
  id: number;
  dates: string[];
}

const ICON_OPTIONS = [
  { icon: '🧘', label: 'Медитация' },
  { icon: '🏋️', label: 'Спорт' },
  { icon: '📖', label: 'Чтение' },
  { icon: '🏃', label: 'Бег' },
  { icon: '💧', label: 'Вода' },
  { icon: '😴', label: 'Сон' },
  { icon: '🥗', label: 'Питание' },
  { icon: '✍️', label: 'Письмо' },
  { icon: '🎯', label: 'Фокус' },
  { icon: '💊', label: 'Витамины' },
  { icon: '🚶', label: 'Прогулка' },
  { icon: '🧠', label: 'Учёба' },
];
const COLOR_OPTIONS = ['#6366f1', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];

function SwipeHabitCard({ habit, done, onToggle }: { habit: Habit; done: boolean; onToggle: () => void }) {
  const [sx, setSx] = useState(0);
  const [startX, setStartX] = useState<number | null>(null);

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* Green background revealed on swipe */}
      {!done && sx > 20 && (
        <div className="absolute inset-0 bg-green-500 flex items-center pl-5 text-white font-bold text-sm rounded-2xl"
          style={{ opacity: Math.min(1, sx / 80) }}>
          ✓ Готово
        </div>
      )}
      <div
        className={`relative flex items-center gap-3 p-4 border-2 cursor-pointer transition-colors active:scale-[0.97] ${
          done
            ? 'border-green-400 dark:border-green-600 bg-green-50 dark:bg-green-900/20'
            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
        }`}
        style={{
          transform: `translateX(${sx}px)`,
          transition: sx === 0 ? 'transform 0.2s ease-out' : 'none',
          borderRadius: '1rem',
        }}
        onClick={() => onToggle()}
        onTouchStart={(e) => { if (!done) setStartX(e.touches[0]!.clientX); }}
        onTouchMove={(e) => {
          if (startX === null || done) return;
          const dx = e.touches[0]!.clientX - startX;
          if (dx > 0) setSx(dx);
        }}
        onTouchEnd={() => {
          if (sx > 80 && !done) onToggle();
          setSx(0);
          setStartX(null);
        }}
      >
        <div
          className={`w-12 h-12 rounded-full flex items-center justify-center text-xl flex-shrink-0 ${
            done ? 'bg-green-500 text-white' : ''
          }`}
          style={!done ? { backgroundColor: habit.color + '22', color: habit.color } : undefined}
        >
          {done ? '✓' : habit.icon}
        </div>
        <div className="flex-1">
          <div className={`font-semibold ${done ? 'line-through text-green-700 dark:text-green-300' : 'text-gray-800 dark:text-gray-100'}`}>
            {habit.title}
          </div>
        </div>
        {habit.streak > 0 && (
          <span className="text-sm text-orange-500 font-bold">🔥 {habit.streak}</span>
        )}
      </div>
    </div>
  );
}

function getToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function HabitsSwipePage() {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [doneIds, setDoneIds] = useState<Set<number>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newIcon, setNewIcon] = useState('🧘');
  const [newColor, setNewColor] = useState('#6366f1');
  const [newRemind, setNewRemind] = useState('');
  const today = getToday();

  const load = useCallback(async () => {
    try {
      const h = await apiGet<Habit[]>('/habits');
      setHabits(h || []);
      try {
        const s = await apiGet<HabitStat[]>('/habits/stats');
        const done = new Set<number>();
        if (s) for (const st of s) { if (st.dates && st.dates.includes(today)) done.add(st.id); }
        setDoneIds(done);
      } catch {}
    } catch {}
  }, [today]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (id: number) => {
    try {
      await apiPost(`/habits/${id}/log`, { date: today });
      setDoneIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
    } catch {}
  };

  const addHabit = async () => {
    if (!newTitle.trim()) return;
    try {
      await apiPost('/habits', { title: newTitle.trim(), icon: newIcon, color: newColor, remind_time: newRemind || undefined });
      setNewTitle(''); setNewIcon('🧘'); setNewColor('#6366f1'); setNewRemind(''); setShowAdd(false);
      load();
    } catch {}
  };

  const doneCount = habits.filter(h => doneIds.has(h.id)).length;

  return (
    <div className="flex flex-col h-full pb-20">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div>
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">🔥 Привычки</h1>
          {habits.length > 0 && (
            <div className="text-xs text-gray-400 mt-0.5">{doneCount} из {habits.length} сегодня</div>
          )}
        </div>
        <button onClick={() => setShowAdd(true)} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm">+ Новая</button>
      </div>

      {/* Progress bar */}
      {habits.length > 0 && (
        <div className="px-4 mb-3">
          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${(doneCount / habits.length) * 100}%` }} />
          </div>
        </div>
      )}

      {/* Habits list */}
      <div className="flex-1 overflow-auto px-4 space-y-2">
        {habits.length === 0 && (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">🔥</div>
            <div className="text-gray-500 dark:text-gray-400">Нет привычек</div>
            <button onClick={() => setShowAdd(true)} className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm">+ Добавить</button>
          </div>
        )}

        {habits.map(h => (
          <SwipeHabitCard key={h.id} habit={h} done={doneIds.has(h.id)} onToggle={() => toggle(h.id)} />
        ))}

        {doneCount === habits.length && habits.length > 0 && (
          <div className="text-center py-8">
            <div className="text-4xl mb-2">🎉</div>
            <div className="text-sm text-gray-500">Все привычки выполнены!</div>
          </div>
        )}
      </div>

      {/* Add modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowAdd(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5 space-y-4">
              <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Новая привычка</h2>

              <input autoFocus className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                placeholder="Название" value={newTitle} onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addHabit()} />

              <div>
                <div className="text-xs text-gray-500 mb-2">Иконка</div>
                <div className="grid grid-cols-3 gap-2">
                  {ICON_OPTIONS.map(({ icon, label }) => (
                    <button key={icon} onClick={() => { setNewIcon(icon); if (!newTitle) setNewTitle(label); }}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm ${
                        newIcon === icon ? 'ring-2 ring-indigo-500 bg-indigo-50 dark:bg-indigo-900/30' : 'bg-gray-50 dark:bg-gray-700'
                      }`}>
                      <span className="text-xl">{icon}</span>
                      <span className="text-gray-600 dark:text-gray-300 truncate">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs text-gray-500 mb-2">Цвет</div>
                <div className="flex gap-3">
                  {COLOR_OPTIONS.map(c => (
                    <button key={c} onClick={() => setNewColor(c)}
                      className={`w-9 h-9 rounded-full ${newColor === c ? 'ring-2 ring-offset-2 ring-gray-400 dark:ring-offset-gray-800' : ''}`}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs text-gray-500 mb-2">⏰ Напоминание (МСК)</div>
                <input type="time" className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                  value={newRemind} onChange={e => setNewRemind(e.target.value)} />
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowAdd(false)} className="flex-1 py-3 rounded-xl border border-gray-200 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-400">Отмена</button>
                <button onClick={addHabit} disabled={!newTitle.trim()} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50">Создать</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
