import { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api/client';
import { useLangStore } from '../store/lang.store';
import { Flame, Plus, Pencil, Trash2, Check, Trophy, TrendingUp } from 'lucide-react';
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

/* ── Circular Progress Ring ── */
function ProgressRing({ done, total, size = 120 }: { done: number; total: number; size?: number }) {
  const { t } = useLangStore();
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = total === 0 ? 0 : done / total;
  const offset = circumference * (1 - pct);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background track */}
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="currentColor"
          className="text-gray-200 dark:text-gray-700/60"
          strokeWidth={stroke}
        />
        {/* Progress arc */}
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          stroke="url(#progressGradient)"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)' }}
        />
        <defs>
          <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#818cf8" />
            <stop offset="50%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#a78bfa" />
          </linearGradient>
        </defs>
      </svg>
      {/* Center text */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-black text-gray-800 dark:text-white leading-none">
          {done}/{total}
        </span>
        <span className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
          {pct >= 1 ? t('Всё!', 'Done!') : t('сегодня', 'today')}
        </span>
      </div>
    </div>
  );
}

/* ── Habit Card ── */
function HabitCard({ habit, isLogged, onToggle }: { habit: Habit; isLogged: boolean; onToggle: () => void }) {
  const [justToggled, setJustToggled] = useState(false);

  const handleToggle = () => {
    setJustToggled(true);
    onToggle();
    setTimeout(() => setJustToggled(false), 600);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative overflow-hidden rounded-2xl cursor-pointer active:scale-[0.97] transition-transform`}
      onClick={handleToggle}
      style={{
        background: isLogged
          ? `linear-gradient(135deg, ${habit.color}18, ${habit.color}08)`
          : undefined,
      }}
    >
      <div className={`flex items-center gap-3.5 p-3.5 rounded-2xl border-2 transition-all duration-300 ${
        isLogged
          ? 'border-green-400/50 dark:border-green-500/30 bg-green-50/50 dark:bg-green-900/10'
          : 'border-gray-200/80 dark:border-gray-700/60 bg-white/70 dark:bg-gray-800/50 backdrop-blur-sm hover:border-indigo-300 dark:hover:border-indigo-600/50'
      }`}>
        {/* Icon / Check circle */}
        <div className="relative flex-shrink-0">
          <motion.div
            animate={justToggled ? { scale: [1, 1.3, 1] } : {}}
            transition={{ duration: 0.4 }}
            className={`w-11 h-11 rounded-xl flex items-center justify-center text-lg transition-all duration-300 ${
              isLogged
                ? 'bg-gradient-to-br from-green-400 to-emerald-500 shadow-lg shadow-green-500/30'
                : 'bg-gray-100 dark:bg-gray-700/70'
            }`}
          >
            {isLogged ? (
              <Check size={20} className="text-white" strokeWidth={3} />
            ) : (
              <span className="text-lg">{habit.icon}</span>
            )}
          </motion.div>
          {/* Ripple on toggle */}
          <AnimatePresence>
            {justToggled && isLogged && (
              <motion.div
                initial={{ scale: 0.5, opacity: 0.6 }}
                animate={{ scale: 2.5, opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6 }}
                className="absolute inset-0 rounded-xl bg-green-400"
              />
            )}
          </AnimatePresence>
        </div>

        {/* Title */}
        <div className="flex-1 min-w-0">
          <div className={`font-semibold text-sm transition-all duration-300 ${
            isLogged
              ? 'text-green-700 dark:text-green-300 line-through decoration-green-400/50'
              : 'text-gray-800 dark:text-gray-100'
          }`}>
            {habit.title}
          </div>
          {habit.streak > 0 && (
            <div className="flex items-center gap-1 mt-0.5">
              <Flame size={12} className="text-orange-500" />
              <span className="text-xs text-orange-500 font-medium">{habit.streak}</span>
            </div>
          )}
        </div>

        {/* Status indicator */}
        <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all duration-300 flex-shrink-0 ${
          isLogged
            ? 'bg-green-500 border-green-500'
            : 'border-gray-300 dark:border-gray-600'
        }`}>
          {isLogged && <Check size={14} className="text-white" strokeWidth={3} />}
        </div>
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
  const bestStreak = habits.reduce((max, h) => Math.max(max, h.streak), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden p-4 max-w-5xl mx-auto pb-24">
      {/* Background decorations */}
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] hidden md:block h-[500px] rounded-full bg-indigo-400/15 dark:bg-indigo-400/[0.10]" style={{ animation: 'circleLeft 30s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] hidden md:block h-[500px] rounded-full bg-purple-400/[0.12] dark:bg-violet-400/[0.08] blur-[80px]" style={{ animation: 'circleRight 34s cubic-bezier(0.45,0,0.55,1) infinite' }} />

      {/* Hero section with progress ring */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 flex flex-col sm:flex-row items-center gap-6 mb-8 p-6 rounded-3xl bg-gradient-to-br from-white/80 to-white/40 dark:from-gray-800/80 dark:to-gray-800/40 backdrop-blur-xl border border-gray-200/50 dark:border-gray-700/50 shadow-xl shadow-indigo-500/5"
      >
        {/* Progress Ring */}
        <ProgressRing done={todayDone} total={habits.length} size={isMobile ? 100 : 120} />

        {/* Stats */}
        <div className="flex-1 text-center sm:text-left">
          <h1 className="text-2xl font-black text-gray-800 dark:text-white mb-1">
            {t('Привычки', 'Habits')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
            {todayDone === habits.length && habits.length > 0
              ? t('Все привычки выполнены! 🎉', 'All habits done! 🎉')
              : t('Отметь выполненное', 'Track your progress')}
          </p>

          {/* Mini stats row */}
          <div className="flex gap-3 justify-center sm:justify-start">
            {bestStreak > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-orange-50 dark:bg-orange-900/20 border border-orange-200/50 dark:border-orange-800/30">
                <Flame size={14} className="text-orange-500 animate-pulse" />
                <span className="text-xs font-bold text-orange-600 dark:text-orange-400">
                  {bestStreak} {t('макс', 'best')}
                </span>
              </div>
            )}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200/50 dark:border-indigo-800/30">
              <TrendingUp size={14} className="text-indigo-500" />
              <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                {habits.length} {t('привычек', 'habits')}
              </span>
            </div>
          </div>
        </div>

        {/* Add button */}
        <button onClick={openCreate}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-indigo-500 text-white rounded-xl hover:from-indigo-700 hover:to-indigo-600 transition-all text-sm font-semibold shadow-lg shadow-indigo-500/25 cursor-pointer active:scale-95">
          <Plus size={16} />
          {t('Привычка', 'Habit')}
        </button>
      </motion.div>

      {habits.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-20"
        >
          <div className="w-20 h-20 mx-auto mb-4 rounded-3xl bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-900/30 dark:to-purple-900/30 flex items-center justify-center">
            <Trophy size={36} className="text-indigo-400" />
          </div>
          <p className="text-lg font-semibold text-gray-600 dark:text-gray-300">{t('Нет привычек', 'No habits yet')}</p>
          <p className="text-sm text-gray-400 mt-1">{t('Добавьте первую привычку', 'Add your first habit')}</p>
        </motion.div>
      ) : (
        <div className="space-y-6 relative z-10">
          {/* Today's checklist */}
          <div>
            <div className="flex items-center gap-2 mb-3 px-1">
              <div className="w-1.5 h-5 rounded-full bg-gradient-to-b from-indigo-500 to-purple-500" />
              <span className="text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider">
                {t('Сегодня', 'Today')}
              </span>
            </div>
            <div className="space-y-2">
              {habits.map((habit) => (
                <HabitCard
                  key={habit.id}
                  habit={habit}
                  isLogged={!!logMap[habit.id]?.has(today)}
                  onToggle={() => toggleLog(habit.id, today)}
                />
              ))}
            </div>

            {/* Completion banner */}
            <AnimatePresence>
              {todayDone === habits.length && habits.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-3 p-4 rounded-2xl bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/20 text-center"
                >
                  <span className="text-2xl">🏆</span>
                  <p className="text-sm font-bold text-green-600 dark:text-green-400 mt-1">
                    {t('Все привычки выполнены!', 'All habits completed!')}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Contribution grids per habit */}
          {habits.map((habit) => {
            const logged = logMap[habit.id] || new Set();
            const completedInGrid = grid.flat().filter(d => d <= today && logged.has(d)).length;
            const totalInGrid = grid.flat().filter(d => d <= today).length;
            const rate = totalInGrid > 0 ? Math.round(completedInGrid / totalInGrid * 100) : 0;

            return (
              <motion.div
                key={habit.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-gray-200/60 dark:border-gray-700/50 bg-white/70 dark:bg-gray-800/50 backdrop-blur-sm overflow-hidden"
              >
                {/* Habit header with gradient accent */}
                <div className="px-4 pt-4 pb-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg"
                      style={{ backgroundColor: habit.color + '20' }}>
                      {habit.icon}
                    </div>
                    <div>
                      <span className="font-bold text-gray-800 dark:text-gray-100 text-sm">
                        {habit.title}
                      </span>
                      <div className="flex items-center gap-2 mt-0.5">
                        {habit.streak > 0 && (
                          <span className="flex items-center gap-1 text-xs text-orange-500 font-semibold">
                            <Flame size={11} className="animate-pulse" />
                            {habit.streak} {t(
                              habit.streak === 1 ? 'день' : habit.streak < 5 ? 'дня' : 'дней',
                              habit.streak === 1 ? 'day' : 'days'
                            )}
                          </span>
                        )}
                        <span className="text-[10px] text-gray-400 font-medium">{rate}%</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <button onClick={(e) => { e.stopPropagation(); openEdit(habit); }}
                      className="p-2 text-gray-400 hover:text-indigo-500 rounded-lg transition-colors cursor-pointer">
                      <Pencil size={14} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); deleteHabit(habit.id); }}
                      className="p-2 text-gray-400 hover:text-red-500 rounded-lg transition-colors cursor-pointer">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Contribution grid */}
                <div className="px-4 pb-4 overflow-x-auto">
                  <div className="inline-flex gap-[3px]">
                    {/* Day labels */}
                    <div className="flex flex-col gap-[3px] mr-1">
                      {DAY_LABELS.map((label, i) => (
                        <div key={i}
                          className="w-5 h-3.5 md:h-[13px] text-[9px] text-gray-400 dark:text-gray-500 flex items-center justify-end pr-0.5 font-medium">
                          {i % 2 === 0 ? label : ''}
                        </div>
                      ))}
                    </div>
                    {/* Grid columns */}
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
                              title={`${DAY_LABELS[rowIdx]}, ${date}${isL ? ` — ${t('выполнено', 'done')}` : ''}`}
                              className={`w-3.5 h-3.5 md:w-[13px] md:h-[13px] rounded-[3px] transition-all duration-200 ${
                                isFuture
                                  ? 'bg-gray-100 dark:bg-gray-700/20'
                                  : isL
                                    ? 'cursor-pointer hover:opacity-80 shadow-sm'
                                    : isToday
                                      ? 'bg-gray-200 dark:bg-gray-600 ring-1.5 ring-indigo-400 dark:ring-indigo-500 cursor-pointer'
                                      : 'bg-gray-100 dark:bg-gray-700/50 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600'
                              }`}
                              style={isL && !isFuture ? { backgroundColor: habit.color } : undefined}
                            />
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-6 w-full max-w-md mx-4 border border-gray-200/50 dark:border-gray-700/50"
              onClick={(e) => e.stopPropagation()}
            >
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

              <div className="flex gap-3 justify-end">
                <button onClick={() => setShowModal(false)}
                  className="px-5 py-2.5 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors font-medium cursor-pointer rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700">
                  {t('Отмена', 'Cancel')}
                </button>
                <button onClick={saveHabit} disabled={!title.trim()}
                  className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-indigo-500 text-white rounded-xl hover:from-indigo-700 hover:to-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm font-semibold shadow-lg shadow-indigo-500/25 cursor-pointer">
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
