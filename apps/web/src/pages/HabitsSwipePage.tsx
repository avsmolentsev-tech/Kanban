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

const EMOJI_OPTIONS = ['✅', '💪', '📚', '🏃', '💧', '🧘', '💊', '🎯', '🌅', '✍️', '🎵', '🍎', '😴', '🚶', '🧠'];
const COLOR_OPTIONS = ['#6366f1', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];

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
  const today = new Date().toISOString().slice(0, 10);

  const fetchData = useCallback(async () => {
    try {
      const [h, s] = await Promise.all([
        apiGet<Habit[]>('/habits'),
        apiGet<HabitStat[]>('/habits/stats'),
      ]);
      setHabits(h);
      const done = new Set<number>();
      for (const st of s) { if (st.dates.includes(today)) done.add(st.id); }
      setDoneToday(done);
    } catch {}
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
  const current = pending[index];

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
      setIndex(i => i + 1);
      setOffset({ x: 0, y: 0 });
      setAnimating(false);
    }, 250);
  };

  // All done!
  if (!current && habits.length > 0) {
    const allDone = habits.length === doneToday.size;
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <div className="text-6xl mb-4">{allDone ? '🔥' : '👋'}</div>
        <div className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-2">
          {allDone ? 'Все привычки выполнены!' : 'Привычки просмотрены!'}
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">
          {doneToday.size} из {habits.length} выполнено сегодня
        </div>
        {habits.map(h => (
          <div key={h.id} className="flex items-center gap-2 text-sm my-0.5">
            <span>{doneToday.has(h.id) ? '✅' : '⬜'}</span>
            <span>{h.icon} {h.title}</span>
            {h.streak > 0 && <span className="text-orange-500">🔥{h.streak}</span>}
          </div>
        ))}
        <button onClick={() => { setIndex(0); fetchData(); }}
          className="mt-6 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">
          Обновить
        </button>
      </div>
    );
  }

  const renderAddModal = () => showAdd ? (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setShowAdd(false)}>
      <div className="bg-white dark:bg-gray-800 rounded-t-2xl shadow-xl p-5 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-3 text-gray-800 dark:text-gray-100">Новая привычка</h2>
        <input autoFocus className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 mb-3"
          placeholder="Например: Цигун" value={newTitle} onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addHabit()} />
        <div className="flex flex-wrap gap-2 mb-3">
          {EMOJI_OPTIONS.map(em => (
            <button key={em} onClick={() => setNewIcon(em)}
              className={`w-9 h-9 text-lg rounded-lg flex items-center justify-center ${newIcon === em ? 'ring-2 ring-indigo-500 bg-indigo-100 dark:bg-indigo-900/50' : 'bg-gray-100 dark:bg-gray-700'}`}>
              {em}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 mb-3">
          {COLOR_OPTIONS.map(c => (
            <button key={c} onClick={() => setNewColor(c)}
              className={`w-8 h-8 rounded-full ${newColor === c ? 'ring-2 ring-offset-2 ring-gray-400' : ''}`}
              style={{ backgroundColor: c }} />
          ))}
        </div>
        <div className="mb-4">
          <div className="text-xs text-gray-500 mb-1">Напоминание (МСК)</div>
          <input type="time" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
            value={newRemind} onChange={e => setNewRemind(e.target.value)} />
        </div>
        <div className="flex gap-3">
          <button onClick={() => setShowAdd(false)} className="flex-1 py-2 text-sm text-gray-600 dark:text-gray-400">Отмена</button>
          <button onClick={addHabit} disabled={!newTitle.trim()} className="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">Создать</button>
        </div>
      </div>
    </div>
  ) : null;

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
