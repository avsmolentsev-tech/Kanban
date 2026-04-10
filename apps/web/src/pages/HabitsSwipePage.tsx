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
  { icon: '🎵', label: 'Музыка' },
  { icon: '💪', label: 'Привычка' },
  { icon: '🌅', label: 'Утро' },
  { icon: '🙏', label: 'Благодарность' },
  { icon: '📵', label: 'Без телефона' },
  { icon: '🧹', label: 'Порядок' },
];
const COLOR_OPTIONS = ['#6366f1', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4'];

export function HabitsSwipePage() {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [doneToday, setDoneToday] = useState<Set<number>>(new Set());
  const [index, setIndex] = useState(0);
  const [view, setView] = useState<'swipe' | 'list'>('swipe');
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newIcon, setNewIcon] = useState('✅');
  const [newColor, setNewColor] = useState('#6366f1');
  const [newRemind, setNewRemind] = useState('');
  const [swipeStart, setSwipeStart] = useState<{ x: number; y: number } | null>(null);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [animating, setAnimating] = useState(false);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const h = await apiGet<Habit[]>('/habits');
      setHabits(h);
      try {
        const s = await apiGet<HabitStat[]>('/habits/stats');
        const done = new Set<number>();
        for (const st of s) { if (st.dates && st.dates.includes(today)) done.add(st.id); }
        setDoneToday(done);
      } catch {}
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    }
  }, [today]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const addHabit = async () => {
    if (!newTitle.trim()) return;
    await apiPost('/habits', { title: newTitle.trim(), icon: newIcon, color: newColor, remind_time: newRemind || null });
    setNewTitle(''); setNewIcon('✅'); setNewColor('#6366f1'); setNewRemind(''); setShowAdd(false);
    fetchData();
  };

  const deleteHabit = async (id: number) => {
    await apiDelete(`/habits/${id}`);
    fetchData();
  };

  const toggleHabit = async (id: number) => {
    await apiPost(`/habits/${id}/log`, { date: today });
    setDoneToday(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    const updated = await apiGet<Habit[]>('/habits');
    setHabits(updated);
  };

  const pending = habits.filter(h => !doneToday.has(h.id));
  // Reset index if out of bounds
  const safeIndex = Math.min(index, Math.max(0, pending.length - 1));
  const current = pending.length > 0 ? pending[safeIndex] : undefined;

  // List view
  if (view === 'list') {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 pt-4 pb-2 border-b dark:border-gray-700">
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">🔥 Привычки</h1>
          <div className="flex gap-2">
            <button onClick={() => setView('swipe')} className="text-xs px-3 py-1 bg-indigo-600 text-white rounded-lg">Карточки</button>
            <button onClick={() => setShowAdd(true)} className="text-xs px-3 py-1 bg-green-600 text-white rounded-lg">+ Новая</button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-2">
          {habits.map(h => {
            const done = doneToday.has(h.id);
            return (
              <div key={h.id} className={`flex items-center gap-3 p-3 rounded-xl border-2 ${done ? 'border-green-400 bg-green-50 dark:bg-green-900/20' : 'border-gray-200 dark:border-gray-700'}`}>
                <button onClick={() => toggleHabit(h.id)}
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0 ${done ? 'bg-green-500 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}>
                  {done ? '✓' : h.icon}
                </button>
                <div className="flex-1">
                  <div className={`font-medium ${done ? 'line-through text-green-700 dark:text-green-300' : 'text-gray-800 dark:text-gray-100'}`}>{h.title}</div>
                  {(h as unknown as Record<string, unknown>)['remind_time'] && (
                    <div className="text-[10px] text-gray-400">⏰ {String((h as unknown as Record<string, unknown>)['remind_time'])}</div>
                  )}
                </div>
                {h.streak > 0 && <span className="text-sm text-orange-500">🔥{h.streak}</span>}
                <button onClick={() => { if (confirm('Удалить?')) deleteHabit(h.id); }} className="text-xs text-red-400 hover:text-red-600">✕</button>
              </div>
            );
          })}
          {habits.length === 0 && <div className="text-center text-gray-400 py-8">Нет привычек</div>}
        </div>
        {renderAddModal()}
      </div>
    );
  }

  const handleSwipe = async (direction: 'left' | 'right') => {
    if (!current || animating) return;
    setAnimating(true);
    setOffset({ x: direction === 'right' ? 600 : -600, y: 0 });

    setTimeout(async () => {
      if (direction === 'right') {
        try {
          await apiPost(`/habits/${current.id}/log`, { date: today });
          setDoneToday(prev => new Set([...prev, current.id]));
        } catch {}
      }
      // Don't increment index since pending array shrinks when habit is done
      // For skip (left swipe), move to next
      if (direction === 'left') setIndex(i => i + 1);
      setOffset({ x: 0, y: 0 });
      setAnimating(false);
    }, 250);
  };

  // All done!
  if (!current && habits.length > 0) {
    const allDone = habits.length === doneToday.size;
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">🔥 Привычки</h1>
          <div className="flex gap-2">
            <button onClick={() => setView('list')} className="text-xs px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg">Список</button>
            <button onClick={() => setShowAdd(true)} className="text-xs px-3 py-1 bg-green-600 text-white rounded-lg">+ Новая</button>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <div className="text-6xl mb-4">{allDone ? '🔥' : '👋'}</div>
          <div className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-2">
            {allDone ? 'Все привычки выполнены!' : 'Привычки просмотрены!'}
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            {doneToday.size} из {habits.length} выполнено сегодня
          </div>
          <div className="space-y-2 mb-6 w-full max-w-xs">
            {habits.map(h => (
              <div key={h.id} onClick={() => toggleHabit(h.id)}
                className={`flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all ${doneToday.has(h.id) ? 'bg-green-50 dark:bg-green-900/20' : 'bg-gray-50 dark:bg-gray-800'}`}>
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${doneToday.has(h.id) ? 'bg-green-500 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}>
                  {doneToday.has(h.id) ? '✓' : ''}
                </span>
                <span className="text-sm">{h.icon} {h.title}</span>
                {h.streak > 0 && <span className="text-xs text-orange-500 ml-auto">🔥{h.streak}</span>}
              </div>
            ))}
          </div>
          <button onClick={() => { setIndex(0); fetchData(); }}
            className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">
            Обновить
          </button>
        </div>
        {renderAddModal()}
      </div>
    );
  }

  const renderAddModal = () => showAdd ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowAdd(false)}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="p-5 space-y-4">
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Новая привычка</h2>

          <input autoFocus className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-base"
            placeholder="Название привычки" value={newTitle} onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addHabit()} />

          {/* Icons with labels */}
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">Иконка</div>
            <div className="grid grid-cols-3 gap-2">
              {ICON_OPTIONS.map(({ icon, label }) => (
                <button key={icon} onClick={() => { setNewIcon(icon); if (!newTitle) setNewTitle(label); }}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-all ${
                    newIcon === icon
                      ? 'ring-2 ring-indigo-500 bg-indigo-50 dark:bg-indigo-900/30'
                      : 'bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600'
                  }`}>
                  <span className="text-xl">{icon}</span>
                  <span className="text-gray-600 dark:text-gray-300 truncate">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Colors */}
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">Цвет</div>
            <div className="flex flex-wrap gap-3">
              {COLOR_OPTIONS.map(c => (
                <button key={c} onClick={() => setNewColor(c)}
                  className={`w-9 h-9 rounded-full transition-all ${newColor === c ? 'ring-2 ring-offset-2 ring-gray-400 dark:ring-offset-gray-800 scale-110' : 'hover:scale-105'}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>

          {/* Reminder */}
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">⏰ Напоминание в Telegram (МСК)</div>
            <input type="time" className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100"
              value={newRemind} onChange={e => setNewRemind(e.target.value)} />
          </div>

          {/* Buttons — prominent position */}
          <div className="flex gap-3 pt-2 pb-2">
            <button onClick={() => setShowAdd(false)} className="flex-1 py-3 text-sm text-gray-600 dark:text-gray-400 rounded-xl border border-gray-200 dark:border-gray-600">Отмена</button>
            <button onClick={addHabit} disabled={!newTitle.trim()} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50">Создать</button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <div className="text-3xl mb-4">⚠️</div>
        <div className="text-sm text-red-500 mb-4">{error}</div>
        <button onClick={fetchData} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm">Повторить</button>
      </div>
    );
  }

  if (habits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <div className="text-5xl mb-4">🔥</div>
        <div className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-2">Нет привычек</div>
        <button onClick={() => setShowAdd(true)} className="mt-3 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm">+ Добавить привычку</button>
        {renderAddModal()}
      </div>
    );
  }

  const rotation = offset.x / 20;
  const doneOpacity = Math.min(1, Math.max(0, offset.x / 100));
  const skipOpacity = Math.min(1, Math.max(0, -offset.x / 100));

  return (
    <div className="flex flex-col h-full p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">🔥 Привычки</h1>
        <div className="flex gap-2">
          <button onClick={() => setView('list')} className="text-xs px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg">Список</button>
          <button onClick={() => setShowAdd(true)} className="text-xs px-3 py-1 bg-green-600 text-white rounded-lg">+ Новая</button>
        </div>
      </div>

      {/* Counter */}
      <div className="text-center mb-4">
        <div className="text-xs text-gray-400 dark:text-gray-500">
          Привычка {index + 1} из {pending.length} | Выполнено: {doneToday.size}/{habits.length}
        </div>
        <div className="mt-2 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div className="h-full bg-orange-500 transition-all" style={{ width: `${(doneToday.size / habits.length) * 100}%` }} />
        </div>
      </div>

      {/* Card */}
      <div className="flex-1 relative flex items-center justify-center">
        {/* Next card preview */}
        {pending[index + 1] && (
          <div className="absolute inset-x-8 top-8 bottom-24 bg-white dark:bg-gray-800 rounded-3xl border border-gray-200 dark:border-gray-700 opacity-40 scale-95" />
        )}

        {/* Current card */}
        <div
          className="absolute inset-x-4 top-4 bottom-20 bg-white dark:bg-gray-800 rounded-3xl shadow-xl border border-gray-200 dark:border-gray-700 flex flex-col items-center justify-center cursor-grab active:cursor-grabbing select-none"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg)`,
            transition: animating ? 'transform 0.25s ease-out' : 'none',
          }}
          onTouchStart={(e) => {
            if (animating) return;
            const t = e.touches[0];
            if (t) setSwipeStart({ x: t.clientX, y: t.clientY });
          }}
          onTouchMove={(e) => {
            if (!swipeStart || animating) return;
            const t = e.touches[0];
            if (!t) return;
            const dx = t.clientX - swipeStart.x;
            const dy = t.clientY - swipeStart.y;
            if (Math.abs(dx) > Math.abs(dy)) {
              setOffset({ x: dx, y: dy * 0.2 });
            }
          }}
          onTouchEnd={() => {
            if (Math.abs(offset.x) > 120) {
              handleSwipe(offset.x > 0 ? 'right' : 'left');
            } else {
              setOffset({ x: 0, y: 0 });
            }
            setSwipeStart(null);
          }}
        >
          {/* Done stamp */}
          <div className="absolute top-8 left-8 px-4 py-2 border-4 border-green-500 rounded-xl text-green-500 font-bold text-2xl rotate-[-20deg] pointer-events-none"
            style={{ opacity: doneOpacity }}>
            ГОТОВО ✓
          </div>

          {/* Skip stamp */}
          <div className="absolute top-8 right-8 px-4 py-2 border-4 border-gray-400 rounded-xl text-gray-400 font-bold text-2xl rotate-[20deg] pointer-events-none"
            style={{ opacity: skipOpacity }}>
            ПРОПУСК
          </div>

          <div className="text-7xl mb-6">{current.icon}</div>
          <div className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-3 px-6 text-center">{current.title}</div>
          {current.streak > 0 && (
            <div className="text-lg text-orange-500 font-medium">🔥 {current.streak} {current.streak === 1 ? 'день' : current.streak < 5 ? 'дня' : 'дней'}</div>
          )}
        </div>

        {/* Buttons */}
        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-6">
          <button onClick={() => handleSwipe('left')} disabled={animating}
            className="w-14 h-14 rounded-full bg-white dark:bg-gray-700 shadow-lg border border-gray-200 dark:border-gray-600 flex items-center justify-center text-2xl hover:scale-110 transition-transform disabled:opacity-50">
            ↻
          </button>
          <button onClick={() => handleSwipe('right')} disabled={animating}
            className="w-16 h-16 rounded-full shadow-lg flex items-center justify-center text-white text-3xl hover:scale-110 transition-transform disabled:opacity-50"
            style={{ backgroundColor: current.color }}>
            ✓
          </button>
        </div>
      </div>

      <div className="text-center text-xs text-gray-400 dark:text-gray-500 mt-2">
        Свайп вправо → выполнено, влево → пропустить
      </div>

      {renderAddModal()}
    </div>
  );
}
