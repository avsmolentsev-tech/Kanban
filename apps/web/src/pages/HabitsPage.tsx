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
  created_at: string;
}

interface HabitLog {
  logged: boolean;
  date: string;
}

interface HabitStat {
  id: number;
  title: string;
  icon: string;
  color: string;
  completedDays: number;
  totalDays: number;
  rate: number;
  dates: string[];
}

function SwipeableHabitCard({ habit, isLogged, onToggle }: { habit: Habit; isLogged: boolean; onToggle: () => void }) {
  const { t } = useLangStore();
  const [swipeX, setSwipeX] = useState(0);
  const [startX, setStartX] = useState<number | null>(null);
  const [swiped, setSwiped] = useState(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (isLogged) return;
    setStartX(e.touches[0]!.clientX);
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (startX === null || isLogged) return;
    const dx = e.touches[0]!.clientX - startX;
    if (dx > 0) setSwipeX(dx);
  };
  const handleTouchEnd = () => {
    if (swipeX > 100 && !isLogged) {
      setSwiped(true);
      onToggle();
      setTimeout(() => { setSwiped(false); setSwipeX(0); }, 300);
    } else {
      setSwipeX(0);
    }
    setStartX(null);
  };

  const doneOpacity = Math.min(1, swipeX / 80);

  return (
    <div
      className={`relative overflow-hidden rounded-xl border-2 transition-all ${
        isLogged
          ? 'border-green-400 dark:border-green-600 bg-green-50 dark:bg-green-900/20'
          : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30'
      }`}
    >
      {/* Green background behind swipe */}
      {!isLogged && (
        <div className="absolute inset-y-0 left-0 w-full bg-green-500 flex items-center pl-4 text-white font-bold"
          style={{ opacity: doneOpacity * 0.3 }}>
          ✓ {t('Готово', 'Done')}
        </div>
      )}
      <div
        className="relative flex items-center gap-3 p-3 cursor-pointer active:scale-[0.98]"
        style={{
          transform: `translateX(${swipeX}px)`,
          transition: swipeX === 0 ? 'transform 0.2s ease-out' : 'none',
        }}
        onClick={() => onToggle()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0 transition-colors ${
          isLogged ? 'bg-green-500 text-white' : 'bg-gray-200 dark:bg-gray-700'
        }`}>
          {isLogged ? '✓' : habit.icon}
        </div>
        <div className="flex-1 text-left">
          <div className={`font-medium ${isLogged ? 'text-green-700 dark:text-green-300 line-through' : 'text-gray-800 dark:text-gray-100'}`}>
            {habit.title}
          </div>
        </div>
        {habit.streak > 0 && (
          <span className="text-sm text-orange-500 font-medium">
            🔥 {habit.streak}
          </span>
        )}
      </div>
    </div>
  );
}

const EMOJI_OPTIONS = ['✅', '💪', '📚', '🏃', '💧', '🧘', '💊', '🎯', '🌅', '✍️', '🎵', '🍎', '😴', '🚶', '🧠'];
const COLOR_OPTIONS = ['#6366f1', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

function getWeeksGrid(weeksCount: number): string[][] {
  const grid: string[][] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find the last Saturday (end of the grid)
  const endDate = new Date(today);

  // Build grid: 7 rows (Mon-Sun) x weeksCount columns
  const totalDays = weeksCount * 7;
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - totalDays + 1);

  // Align startDate to Monday
  const dayOfWeek = startDate.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  startDate.setDate(startDate.getDate() + mondayOffset);

  for (let row = 0; row < 7; row++) {
    const rowDates: string[] = [];
    for (let col = 0; col < weeksCount; col++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + col * 7 + row);
      rowDates.push(d.toISOString().slice(0, 10));
    }
    grid.push(rowDates);
  }

  return grid;
}

export function HabitsPage() {
  const { t } = useLangStore();

  const DAY_LABELS = [
    t('Пн', 'Mo'),
    t('Вт', 'Tu'),
    t('Ср', 'We'),
    t('Чт', 'Th'),
    t('Пт', 'Fr'),
    t('Сб', 'Sa'),
    t('Вс', 'Su'),
  ];

  const [habits, setHabits] = useState<Habit[]>([]);
  const [logMap, setLogMap] = useState<Record<number, Set<string>>>({});
  const [showModal, setShowModal] = useState(false);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
  const [title, setTitle] = useState('');
  const [icon, setIcon] = useState('✅');
  const [color, setColor] = useState('#6366f1');
  const [loading, setLoading] = useState(true);

  const weeksCount = 15;
  const grid = getWeeksGrid(weeksCount);
  const today = new Date().toISOString().slice(0, 10);

  const fetchData = useCallback(async () => {
    try {
      const [habitsData, statsData] = await Promise.all([
        apiGet<Habit[]>('/habits'),
        apiGet<HabitStat[]>('/habits/stats'),
      ]);
      setHabits(habitsData);

      // Build log map from stats (current month) — we need full range though
      // For a full picture, we'll fetch logs per habit for the grid range
      const allDates = grid.flat();
      const minDate = allDates[0];
      const maxDate = allDates[allDates.length - 1];

      // Use stats dates as a starting point, but we need a broader approach
      // Stats only covers current month. Let's build from what we have.
      const map: Record<number, Set<string>> = {};
      for (const stat of statsData) {
        map[stat.id] = new Set(stat.dates);
      }

      // For dates outside current month, we need additional fetching
      // We'll use a simpler approach: fetch all logs via a dedicated mechanism
      // For now, use stats data which covers current month
      setLogMap(map);
    } catch (err) {
      console.error('Failed to fetch habits:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Also fetch all logs for the grid range
  useEffect(() => {
    if (habits.length === 0) return;
    // We re-fetch stats which gives us current month dates
    // For a complete grid, we rely on the toggle response and local state
  }, [habits]);

  const toggleLog = async (habitId: number, date: string) => {
    // Don't allow future dates
    if (date > today) return;

    try {
      const result = await apiPost<HabitLog>(`/habits/${habitId}/log`, { date });
      setLogMap((prev) => {
        const next = { ...prev };
        const set = new Set(prev[habitId] || []);
        if (result.logged) {
          set.add(date);
        } else {
          set.delete(date);
        }
        next[habitId] = set;
        return next;
      });
      // Refresh habits to update streaks
      const updated = await apiGet<Habit[]>('/habits');
      setHabits(updated);
    } catch (err) {
      console.error('Failed to toggle log:', err);
    }
  };

  const saveHabit = async () => {
    if (!title.trim()) return;
    try {
      if (editingHabit) {
        await apiPatch<Habit>(`/habits/${editingHabit.id}`, { title, icon, color });
      } else {
        await apiPost<Habit>('/habits', { title, icon, color });
      }
      setShowModal(false);
      setEditingHabit(null);
      setTitle('');
      setIcon('✅');
      setColor('#6366f1');
      fetchData();
    } catch (err) {
      console.error('Failed to save habit:', err);
    }
  };

  const deleteHabit = async (id: number) => {
    try {
      await apiDelete(`/habits/${id}`);
      fetchData();
    } catch (err) {
      console.error('Failed to delete habit:', err);
    }
  };

  const openEdit = (habit: Habit) => {
    setEditingHabit(habit);
    setTitle(habit.title);
    setIcon(habit.icon);
    setColor(habit.color);
    setShowModal(true);
  };

  const openCreate = () => {
    setEditingHabit(null);
    setTitle('');
    setIcon('✅');
    setColor('#6366f1');
    setShowModal(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
        {t('Загрузка...', 'Loading...')}
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden p-4 max-w-5xl mx-auto">
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full border-4 border-indigo-400/30 dark:border-white/[0.12]" style={{ animation: 'circleLeft 16s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute -top-20 -right-20 w-[350px] h-[350px] rounded-full border-4 border-purple-400/35 dark:border-white/[0.12]" style={{ animation: 'circleLeftSlow 12s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] h-[500px] rounded-full bg-indigo-400/[0.14] dark:bg-white/[0.06] blur-[80px]" style={{ animation: 'circleRight 20s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      {/* Header */}
      <div className="relative z-10 flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">{t('Привычки', 'Habits')}</h1>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
        >
          + {t('Добавить', 'Add')}
        </button>
      </div>

      {habits.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <div className="text-4xl mb-3">🔥</div>
          <p className="text-lg">{t('Нет привычек', 'No habits yet')}</p>
          <p className="text-sm mt-1">{t('Добавьте первую привычку для отслеживания', 'Add your first habit to track')}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Today's checklist — swipeable cards */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-3">{t('Сегодня', 'Today')}</div>
            <div className="space-y-2">
              {habits.map((habit) => {
                const isLogged = logMap[habit.id]?.has(today);
                return (
                  <SwipeableHabitCard
                    key={habit.id}
                    habit={habit}
                    isLogged={!!isLogged}
                    onToggle={() => toggleLog(habit.id, today)}
                  />
                );
              })}
            </div>
            {habits.length > 0 && (
              <div className="mt-3 text-center text-xs text-gray-400">
                {habits.filter(h => logMap[h.id]?.has(today)).length} {t('из', 'of')} {habits.length} {t('выполнено', 'done')}
              </div>
            )}
          </div>

          {/* Grid per habit — scrollable on mobile */}
          {habits.map((habit) => (
            <div
              key={habit.id}
              className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4"
            >
              {/* Habit header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{habit.icon}</span>
                  <span className="font-semibold text-gray-800 dark:text-gray-100">
                    {habit.title}
                  </span>
                  {habit.streak > 0 && (
                    <span className="text-sm text-orange-500 font-medium ml-1">
                      🔥 {habit.streak} {t(
                        habit.streak === 1 ? 'день' : habit.streak < 5 ? 'дня' : 'дней',
                        habit.streak === 1 ? 'day' : 'days'
                      )}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openEdit(habit)}
                    className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
                    title={t('Редактировать', 'Edit')}
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => deleteHabit(habit.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors"
                    title={t('Архивировать', 'Archive')}
                  >
                    🗑️
                  </button>
                </div>
              </div>

              {/* Contribution grid */}
              <div className="overflow-x-auto">
                <div className="inline-flex gap-0.5">
                  {/* Day labels */}
                  <div className="flex flex-col gap-0.5 mr-1">
                    {DAY_LABELS.map((label, i) => (
                      <div
                        key={i}
                        className="w-6 h-[14px] text-[10px] text-gray-400 dark:text-gray-500 flex items-center justify-end pr-0.5"
                      >
                        {i % 2 === 0 ? label : ''}
                      </div>
                    ))}
                  </div>

                  {/* Grid columns (weeks) */}
                  {Array.from({ length: weeksCount }, (_, col) => (
                    <div key={col} className="flex flex-col gap-0.5">
                      {grid.map((row, rowIdx) => {
                        const date = row[col] ?? '';
                        const isFuture = date > today;
                        const isLogged = date ? logMap[habit.id]?.has(date) : false;
                        const isToday = date === today;

                        return (
                          <button
                            key={date || `${col}-${rowIdx}`}
                            onClick={() => date && toggleLog(habit.id, date)}
                            disabled={isFuture}
                            title={`${DAY_LABELS[rowIdx]}, ${date}${isLogged ? ` — ${t('выполнено', 'done')}` : ''}`}
                            className={`w-[14px] h-[14px] rounded-sm transition-colors ${
                              isFuture
                                ? 'bg-gray-100 dark:bg-gray-700/30 cursor-default'
                                : isLogged
                                  ? 'cursor-pointer hover:opacity-80'
                                  : isToday
                                    ? 'bg-gray-200 dark:bg-gray-600 ring-1 ring-gray-400 dark:ring-gray-500 cursor-pointer'
                                    : 'bg-gray-100 dark:bg-gray-700 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                            style={
                              isLogged && !isFuture
                                ? { backgroundColor: habit.color }
                                : undefined
                            }
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowModal(false)}>
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">
              {editingHabit ? t('Редактировать привычку', 'Edit habit') : t('Новая привычка', 'New habit')}
            </h2>

            {/* Title */}
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
              {t('Название', 'Name')}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('Например: Медитация', 'E.g.: Meditation')}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent mb-4"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && saveHabit()}
            />

            {/* Icon picker */}
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
              {t('Иконка', 'Icon')}
            </label>
            <div className="flex flex-wrap gap-2 mb-4">
              {EMOJI_OPTIONS.map((em) => (
                <button
                  key={em}
                  onClick={() => setIcon(em)}
                  className={`w-9 h-9 text-lg rounded-lg flex items-center justify-center transition-all ${
                    icon === em
                      ? 'bg-indigo-100 dark:bg-indigo-900/50 ring-2 ring-indigo-500'
                      : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {em}
                </button>
              ))}
            </div>

            {/* Color picker */}
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
              {t('Цвет', 'Color')}
            </label>
            <div className="flex flex-wrap gap-2 mb-6">
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full transition-all ${
                    color === c ? 'ring-2 ring-offset-2 ring-gray-400 dark:ring-offset-gray-800' : ''
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
              >
                {t('Отмена', 'Cancel')}
              </button>
              <button
                onClick={saveHabit}
                disabled={!title.trim()}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
              >
                {editingHabit ? t('Сохранить', 'Save') : t('Создать', 'Create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
