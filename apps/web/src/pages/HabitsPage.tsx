import { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api/client';
import { useLangStore } from '../store/lang.store';
import { Plus, Pencil, Trash2, Flame } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

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

/* ── Large Ring — Streaks style ── */
function HabitRing({
  habit, isLogged, onToggle, onEdit,
}: {
  habit: Habit; isLogged: boolean; onToggle: () => void; onEdit: () => void;
}) {
  const { t } = useLangStore();
  const [pulse, setPulse] = useState(false);
  const size = 130;
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = isLogged ? 0 : circumference;

  const handleTap = () => {
    if (!isLogged) setPulse(true);
    onToggle();
    setTimeout(() => setPulse(false), 500);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', damping: 20 }}
      className="flex flex-col items-center gap-2 cursor-pointer group"
      onClick={handleTap}
    >
      {/* Ring */}
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="transform -rotate-90">
          {/* Track */}
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" strokeWidth={stroke}
            className="stroke-white/20"
          />
          {/* Progress */}
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" strokeWidth={stroke}
            strokeLinecap="round"
            className="stroke-white"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{
              transition: 'stroke-dashoffset 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
              filter: isLogged ? 'drop-shadow(0 0 8px rgba(255,255,255,0.5))' : 'none',
            }}
          />
        </svg>

        {/* Center — emoji + pulse */}
        <div className="absolute inset-0 flex items-center justify-center">
          <AnimatePresence>
            {pulse && (
              <motion.div
                initial={{ scale: 0.5, opacity: 0.7 }}
                animate={{ scale: 2.5, opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
                className="absolute w-16 h-16 rounded-full bg-white/30"
              />
            )}
          </AnimatePresence>
          <motion.span
            animate={pulse ? { scale: [1, 1.4, 1] } : {}}
            transition={{ duration: 0.35 }}
            className={`text-4xl select-none transition-all duration-300 ${isLogged ? 'grayscale-0' : 'grayscale-0'}`}
          >
            {isLogged ? '✓' : habit.icon}
          </motion.span>
        </div>

        {/* Streak badge */}
        {habit.streak > 0 && (
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-white/20 backdrop-blur-sm">
            <Flame size={10} className="text-orange-300" />
            <span className="text-[11px] font-bold text-white">{habit.streak}</span>
          </div>
        )}

        {/* Edit button (on hover/long-press) */}
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="absolute top-0 right-0 p-1.5 rounded-full bg-white/10 text-white/50 hover:text-white hover:bg-white/20 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
        >
          <Pencil size={12} />
        </button>
      </div>

      {/* Label */}
      <div className="text-center max-w-[130px]">
        <div className={`text-xs font-bold uppercase tracking-wider leading-tight transition-all duration-300 ${
          isLogged ? 'text-white' : 'text-white/70'
        }`}>
          {habit.title}
        </div>
      </div>
    </motion.div>
  );
}

/* ── Add Button Cell ── */
function AddHabitCell({ onClick }: { onClick: () => void }) {
  const { t } = useLangStore();
  const size = 130;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center gap-2 cursor-pointer"
      onClick={onClick}
    >
      <div className="relative flex items-center justify-center rounded-full border-2 border-dashed border-white/30 hover:border-white/50 transition-all"
        style={{ width: size, height: size }}>
        <Plus size={36} className="text-white/40" />
      </div>
      <div className="text-xs font-bold uppercase tracking-wider text-white/40">
        {t('Добавить', 'Add')}
      </div>
    </motion.div>
  );
}

const EMOJI_OPTIONS = ['✅', '💪', '📚', '🏃', '💧', '🧘', '💊', '🎯', '🌅', '✍️', '🎵', '🍎', '😴', '🚶', '🧠', '🧹', '💰', '🎨', '🌿', '☀️'];
const COLOR_OPTIONS = ['#6366f1', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4'];

function getWeeksGrid(weeksCount: number): string[][] {
  const grid: string[][] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = new Date(today);
  const totalDays = weeksCount * 7;
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - totalDays + 1);
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
    t('Пн', 'Mo'), t('Вт', 'Tu'), t('Ср', 'We'), t('Чт', 'Th'),
    t('Пт', 'Fr'), t('Сб', 'Sa'), t('Вс', 'Su'),
  ];

  const [habits, setHabits] = useState<Habit[]>([]);
  const [logMap, setLogMap] = useState<Record<number, Set<string>>>({});
  const [showModal, setShowModal] = useState(false);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
  const [title, setTitle] = useState('');
  const [icon, setIcon] = useState('✅');
  const [color, setColor] = useState('#6366f1');
  const [loading, setLoading] = useState(true);
  const [showGrids, setShowGrids] = useState(false);

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const weeksCount = isMobile ? 8 : 15;
  const grid = getWeeksGrid(weeksCount);
  const today = new Date().toISOString().slice(0, 10);

  const fetchData = useCallback(async () => {
    try {
      const [habitsData, statsData] = await Promise.all([
        apiGet<Habit[]>('/habits'),
        apiGet<HabitStat[]>('/habits/stats'),
      ]);
      setHabits(habitsData);
      const map: Record<number, Set<string>> = {};
      for (const stat of statsData) {
        map[stat.id] = new Set(stat.dates);
      }
      setLogMap(map);
    } catch (err) {
      console.error('Failed to fetch habits:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleLog = async (habitId: number, date: string) => {
    if (date > today) return;
    try {
      const result = await apiPost<HabitLog>(`/habits/${habitId}/log`, { date });
      setLogMap((prev) => {
        const next = { ...prev };
        const set = new Set(prev[habitId] || []);
        if (result.logged) { set.add(date); } else { set.delete(date); }
        next[habitId] = set;
        return next;
      });
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
      setTitle(''); setIcon('✅'); setColor('#6366f1');
      fetchData();
    } catch (err) {
      console.error('Failed to save habit:', err);
    }
  };

  const deleteHabit = async (id: number) => {
    try { await apiDelete(`/habits/${id}`); fetchData(); } catch (err) {
      console.error('Failed to delete habit:', err);
    }
  };

  const openEdit = (habit: Habit) => {
    setEditingHabit(habit);
    setTitle(habit.title); setIcon(habit.icon); setColor(habit.color);
    setShowModal(true);
  };

  const openCreate = () => {
    setEditingHabit(null);
    setTitle(''); setIcon('✅'); setColor('#6366f1');
    setShowModal(true);
  };

  const todayDone = habits.filter(h => logMap[h.id]?.has(today)).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-3 border-white border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden pb-24">
      {/* Vibrant gradient background — full page */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-purple-600 to-fuchsia-500" />
      {/* Subtle animated orbs */}
      <div className="pointer-events-none absolute top-20 -left-20 w-[300px] h-[300px] rounded-full bg-blue-400/20 blur-[80px]" style={{ animation: 'circleLeft 30s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-40 -right-20 w-[350px] h-[350px] rounded-full bg-pink-400/20 blur-[80px]" style={{ animation: 'circleRight 28s cubic-bezier(0.45,0,0.55,1) infinite' }} />

      {/* Header */}
      <div className="relative z-10 px-5 pt-5 pb-2 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">{t('Привычки', 'Habits')}</h1>
          <p className="text-sm text-white/60 font-medium">
            {todayDone}/{habits.length} {t('сегодня', 'today')}
            {todayDone === habits.length && habits.length > 0 && ' ✨'}
          </p>
        </div>
        {/* Overall streak summary */}
        {habits.some(h => h.streak > 0) && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl bg-white/10 backdrop-blur-sm">
            <Flame size={16} className="text-orange-300 animate-pulse" />
            <span className="text-sm font-bold text-white">
              {Math.max(...habits.map(h => h.streak))}
            </span>
            <span className="text-[10px] text-white/50">{t('макс', 'best')}</span>
          </div>
        )}
      </div>

      {/* ── Ring Grid — Streaks style ── */}
      <div className="relative z-10 px-4 py-6">
        <div className={`grid gap-6 justify-items-center ${
          habits.length <= 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'
        }`}>
          {habits.map((habit) => (
            <HabitRing
              key={habit.id}
              habit={habit}
              isLogged={!!logMap[habit.id]?.has(today)}
              onToggle={() => toggleLog(habit.id, today)}
              onEdit={() => openEdit(habit)}
            />
          ))}
          <AddHabitCell onClick={openCreate} />
        </div>
      </div>

      {/* All done banner */}
      <AnimatePresence>
        {todayDone === habits.length && habits.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="relative z-10 mx-5 mb-4 p-4 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/10 text-center"
          >
            <span className="text-2xl">🏆</span>
            <p className="text-sm font-bold text-white mt-1">{t('Все привычки выполнены!', 'All habits completed!')}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toggle contribution grids */}
      <div className="relative z-10 px-5 mb-3">
        <button
          onClick={() => setShowGrids(!showGrids)}
          className="text-xs font-semibold text-white/40 hover:text-white/70 transition-colors uppercase tracking-wider cursor-pointer"
        >
          {showGrids ? t('Скрыть историю', 'Hide history') : t('Показать историю', 'Show history')} ↓
        </button>
      </div>

      {/* Contribution grids */}
      <AnimatePresence>
        {showGrids && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="relative z-10 px-4 space-y-4 pb-8"
          >
            {habits.map((habit) => {
              const logged = logMap[habit.id] || new Set();
              const completedInGrid = grid.flat().filter(d => d <= today && logged.has(d)).length;
              const totalInGrid = grid.flat().filter(d => d <= today).length;
              const rate = totalInGrid > 0 ? Math.round(completedInGrid / totalInGrid * 100) : 0;

              return (
                <div key={habit.id} className="rounded-2xl bg-white/10 backdrop-blur-sm border border-white/10 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{habit.icon}</span>
                      <span className="text-sm font-bold text-white">{habit.title}</span>
                      {habit.streak > 0 && (
                        <span className="flex items-center gap-0.5 text-xs text-orange-300 font-semibold">
                          <Flame size={10} /> {habit.streak}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-white/40 font-medium">{rate}%</span>
                  </div>

                  <div className="overflow-x-auto">
                    <div className="inline-flex gap-[3px]">
                      <div className="flex flex-col gap-[3px] mr-1">
                        {DAY_LABELS.map((label, i) => (
                          <div key={i} className="w-5 h-3.5 md:h-[13px] text-[9px] text-white/30 flex items-center justify-end pr-0.5 font-medium">
                            {i % 2 === 0 ? label : ''}
                          </div>
                        ))}
                      </div>
                      {Array.from({ length: weeksCount }, (_, col) => (
                        <div key={col} className="flex flex-col gap-[3px]">
                          {grid.map((row, rowIdx) => {
                            const date = row[col] ?? '';
                            const isFuture = date > today;
                            const isL = date ? logged.has(date) : false;
                            const isToday = date === today;
                            return (
                              <button
                                key={date || `${col}-${rowIdx}`}
                                onClick={() => date && toggleLog(habit.id, date)}
                                disabled={isFuture}
                                className={`w-3.5 h-3.5 md:w-[13px] md:h-[13px] rounded-[3px] transition-all duration-200 ${
                                  isFuture
                                    ? 'bg-white/5'
                                    : isL
                                      ? 'bg-white cursor-pointer hover:opacity-80 shadow-sm shadow-white/20'
                                      : isToday
                                        ? 'bg-white/20 ring-1 ring-white/50 cursor-pointer'
                                        : 'bg-white/10 cursor-pointer hover:bg-white/20'
                                }`}
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Add/Edit Modal ── */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
          >
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="bg-white dark:bg-gray-800 rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 w-full max-w-md sm:mx-4 border-t border-gray-200/50 dark:border-gray-700/50"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-600 mx-auto mb-5 sm:hidden" />

              <h2 className="text-xl font-black text-gray-800 dark:text-gray-100 mb-5">
                {editingHabit ? t('Редактировать', 'Edit habit') : t('Новая привычка', 'New habit')}
              </h2>

              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                {t('Название', 'Name')}
              </label>
              <input
                type="text" value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('Например: Медитация', 'E.g.: Meditation')}
                className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700/50 text-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent mb-5 text-sm"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && saveHabit()}
              />

              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                {t('Иконка', 'Icon')}
              </label>
              <div className="flex flex-wrap gap-1.5 mb-5">
                {EMOJI_OPTIONS.map((em) => (
                  <button key={em} onClick={() => setIcon(em)}
                    className={`w-10 h-10 text-lg rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                      icon === em
                        ? 'bg-indigo-100 dark:bg-indigo-900/50 ring-2 ring-indigo-500 scale-110'
                        : 'bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-600'
                    }`}>
                    {em}
                  </button>
                ))}
              </div>

              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                {t('Цвет', 'Color')}
              </label>
              <div className="flex flex-wrap gap-2 mb-6">
                {COLOR_OPTIONS.map((c) => (
                  <button key={c} onClick={() => setColor(c)}
                    className={`w-8 h-8 rounded-full transition-all cursor-pointer ${
                      color === c ? 'ring-2 ring-offset-2 ring-gray-400 dark:ring-offset-gray-800 scale-110' : 'hover:scale-110'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>

              <div className="flex gap-3">
                {editingHabit && (
                  <button
                    onClick={() => { deleteHabit(editingHabit.id); setShowModal(false); }}
                    className="px-4 py-2.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors cursor-pointer"
                  >
                    <Trash2 size={18} />
                  </button>
                )}
                <div className="flex-1" />
                <button onClick={() => setShowModal(false)}
                  className="px-5 py-2.5 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors font-medium cursor-pointer rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700">
                  {t('Отмена', 'Cancel')}
                </button>
                <button onClick={saveHabit} disabled={!title.trim()}
                  className="px-6 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm font-semibold shadow-lg shadow-indigo-500/25 cursor-pointer">
                  {editingHabit ? t('Сохранить', 'Save') : t('Создать', 'Create')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
