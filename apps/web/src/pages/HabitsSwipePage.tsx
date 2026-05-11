import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api/client';
import { useLangStore } from '../store/lang.store';
import {
  Flame, Plus, Check, Trash2, X, Clock, Zap, Trophy,
  Brain, Dumbbell, PersonStanding, Bike, Waves, Mountain,
  Droplets, Salad, Moon, Pill, Footprints, Sparkles,
  BookOpen, PenLine, GraduationCap, Target, NotebookPen, Headphones,
  AlarmClock, SmartphoneNfc, Brush, Wallet, Palette, Heart, Settings2
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface Habit { id: number; title: string; icon: string; color: string; frequency: string; streak: number; remind_time?: string; }
interface HabitStat { id: number; dates: string[]; }

const LUCIDE_MAP: Record<string, LucideIcon> = {
  brain: Brain, dumbbell: Dumbbell, running: PersonStanding, bike: Bike,
  swim: Waves, climb: Mountain, water: Droplets, salad: Salad,
  sleep: Moon, pill: Pill, walk: Footprints, sparkles: Sparkles,
  book: BookOpen, pen: PenLine, study: GraduationCap, target: Target,
  journal: NotebookPen, headphones: Headphones, alarm: AlarmClock,
  'phone-off': SmartphoneNfc, brush: Brush, wallet: Wallet,
  palette: Palette, heart: Heart, flame: Flame, zap: Zap,
};

function HIcon({ icon, size = 20, className = '' }: { icon: string; size?: number; className?: string }) {
  const C = LUCIDE_MAP[icon];
  if (C) return <C size={size} className={className} strokeWidth={2} />;
  return <span style={{ fontSize: size * 0.9 }}>{icon}</span>;
}

const ICONS = [
  { icon: 'brain', l: ['Медитация', 'Meditation'] },
  { icon: 'dumbbell', l: ['Спорт', 'Sport'] },
  { icon: 'running', l: ['Бег', 'Running'] },
  { icon: 'bike', l: ['Велосипед', 'Cycling'] },
  { icon: 'swim', l: ['Плавание', 'Swimming'] },
  { icon: 'water', l: ['Вода', 'Water'] },
  { icon: 'salad', l: ['Питание', 'Nutrition'] },
  { icon: 'sleep', l: ['Сон', 'Sleep'] },
  { icon: 'pill', l: ['Витамины', 'Vitamins'] },
  { icon: 'walk', l: ['Прогулка', 'Walk'] },
  { icon: 'sparkles', l: ['Уход', 'Self-care'] },
  { icon: 'book', l: ['Чтение', 'Reading'] },
  { icon: 'pen', l: ['Письмо', 'Writing'] },
  { icon: 'study', l: ['Учёба', 'Study'] },
  { icon: 'target', l: ['Фокус', 'Focus'] },
  { icon: 'headphones', l: ['Подкасты', 'Podcasts'] },
  { icon: 'alarm', l: ['Ранний подъём', 'Early rise'] },
  { icon: 'wallet', l: ['Финансы', 'Finance'] },
  { icon: 'palette', l: ['Творчество', 'Creativity'] },
  { icon: 'heart', l: ['Благодарность', 'Gratitude'] },
];
const COLORS = ['#6366f1', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];
const FREQS = [
  { v: 'daily', l: ['Каждый день', 'Every day'] },
  { v: '2x_week', l: ['2 раза/нед', '2x/week'] },
  { v: '3x_week', l: ['3 раза/нед', '3x/week'] },
  { v: 'weekly', l: ['Раз в нед', 'Weekly'] },
];

function getToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ── Ring component for mobile ── */
function HabitRing({
  habit, isLogged, onToggle, onEdit,
}: {
  habit: Habit; isLogged: boolean; onToggle: () => void; onEdit: () => void;
}) {
  const [pulse, setPulse] = useState(false);
  const size = 110;
  const stroke = 6;
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
      className="flex flex-col items-center gap-1.5 cursor-pointer group"
      onClick={handleTap}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="transform -rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius}
            fill="none" strokeWidth={stroke}
            className="stroke-gray-200 dark:stroke-gray-700" />
          <circle cx={size / 2} cy={size / 2} r={radius}
            fill="none" strokeWidth={stroke} strokeLinecap="round"
            stroke={isLogged ? '#10b981' : habit.color}
            strokeDasharray={circumference} strokeDashoffset={offset}
            style={{
              transition: 'stroke-dashoffset 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
              filter: isLogged ? `drop-shadow(0 0 6px ${habit.color}40)` : 'none',
            }}
          />
        </svg>

        {/* Center */}
        <div className="absolute inset-0 flex items-center justify-center">
          <AnimatePresence>
            {pulse && (
              <motion.div
                initial={{ scale: 0.5, opacity: 0.7 }}
                animate={{ scale: 2.5, opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
                className="absolute w-12 h-12 rounded-full bg-green-400/30"
              />
            )}
          </AnimatePresence>
          <motion.div
            animate={pulse ? { scale: [1, 1.3, 1] } : {}}
            transition={{ duration: 0.35 }}
          >
            {isLogged
              ? <Check size={28} className="text-green-500" strokeWidth={3} />
              : <HIcon icon={habit.icon} size={28} className="text-gray-600 dark:text-gray-300" />
            }
          </motion.div>
        </div>

        {/* Streak badge */}
        {habit.streak > 0 && (
          <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30">
            <Zap size={9} className="text-orange-500" fill="currentColor" />
            <span className="text-[10px] font-bold text-orange-600 dark:text-orange-400">{habit.streak}</span>
          </div>
        )}

        {/* Edit */}
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="absolute top-0 right-0 p-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-400 opacity-0 group-hover:opacity-100 active:opacity-100 transition-all"
        >
          <Settings2 size={11} />
        </button>
      </div>

      {/* Label */}
      <div className="text-center" style={{ maxWidth: size }}>
        <div className={`text-[11px] font-bold uppercase tracking-wide leading-tight ${
          isLogged ? 'text-green-600 dark:text-green-400' : 'text-gray-600 dark:text-gray-300'
        }`}>
          {habit.title}
        </div>
      </div>
    </motion.div>
  );
}

export function HabitsSwipePage() {
  const { t } = useLangStore();
  const [habits, setHabits] = useState<Habit[]>([]);
  const [doneIds, setDoneIds] = useState<Set<number>>(new Set());
  const [logMap, setLogMap] = useState<Record<number, Set<string>>>({});
  const [modal, setModal] = useState<'add' | 'edit' | null>(null);
  const [editHabit, setEditHabit] = useState<Habit | null>(null);
  const [title, setTitle] = useState('');
  const [icon, setIcon] = useState('brain');
  const [color, setColor] = useState('#6366f1');
  const [freq, setFreq] = useState('daily');
  const [remind, setRemind] = useState('');
  const today = getToday();

  const load = useCallback(async () => {
    try {
      const h = await apiGet<Habit[]>('/habits');
      setHabits(h || []);
      const s = await apiGet<HabitStat[]>('/habits/stats');
      const done = new Set<number>();
      const lm: Record<number, Set<string>> = {};
      if (s) for (const st of s) {
        if (st.dates) { lm[st.id] = new Set(st.dates); if (st.dates.includes(today)) done.add(st.id); }
      }
      setDoneIds(done); setLogMap(lm);
    } catch {}
  }, [today]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (id: number) => {
    try {
      await apiPost(`/habits/${id}/log`, { date: today });
      setDoneIds(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
      setLogMap(p => { const n = { ...p }; const s = new Set(p[id] || []); if (s.has(today)) s.delete(today); else s.add(today); n[id] = s; return n; });
      // Refresh streaks
      const updated = await apiGet<Habit[]>('/habits');
      if (updated) setHabits(updated);
    } catch {}
  };

  const openAdd = () => { setEditHabit(null); setTitle(''); setIcon('brain'); setColor('#6366f1'); setFreq('daily'); setRemind(''); setModal('add'); };
  const openEdit = (h: Habit) => { setEditHabit(h); setTitle(h.title); setIcon(h.icon); setColor(h.color); setFreq(h.frequency||'daily'); setRemind(h.remind_time||''); setModal('edit'); };

  const save = async () => {
    if (!title.trim()) return;
    try {
      const body = { title: title.trim(), icon, color, frequency: freq, remind_time: remind || null };
      if (editHabit) await apiPatch(`/habits/${editHabit.id}`, body);
      else await apiPost('/habits', body);
      setModal(null); load();
    } catch {}
  };

  const remove = async () => {
    if (!editHabit || !confirm(t('Удалить привычку?', 'Delete habit?'))) return;
    await apiDelete(`/habits/${editHabit.id}`); setModal(null); load();
  };

  const doneCount = habits.filter(h => doneIds.has(h.id)).length;
  const total = habits.length;

  return (
    <div className="flex flex-col h-full pb-24 relative overflow-hidden">
      {/* Header */}
      <div className="relative z-10 px-4 pt-4 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center shadow-lg shadow-orange-500/25">
              <Flame size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('Привычки', 'Habits')}</h1>
              <p className="text-[10px] text-gray-400">
                {doneCount}/{total} {t('сегодня', 'today')}
                {doneCount === total && total > 0 && ' ✨'}
              </p>
            </div>
          </div>
          <button onClick={openAdd}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium shadow-lg shadow-indigo-500/25 active:scale-95 transition-all">
            <Plus size={16} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {/* Ring Grid */}
      <div className="relative z-10 flex-1 overflow-auto px-4 pt-4">
        {total === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-orange-500/10 to-red-500/10 flex items-center justify-center mx-auto mb-4">
              <Flame size={36} className="text-orange-400" />
            </div>
            <div className="text-gray-500 dark:text-gray-400 font-medium">{t('Нет привычек', 'No habits')}</div>
            <button onClick={openAdd} className="mt-4 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium shadow-lg shadow-indigo-500/25">
              <Plus size={16} className="inline mr-1" /> {t('Добавить', 'Add')}
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 justify-items-center">
              {habits.map((h) => (
                <HabitRing
                  key={h.id}
                  habit={h}
                  isLogged={doneIds.has(h.id)}
                  onToggle={() => toggle(h.id)}
                  onEdit={() => openEdit(h)}
                />
              ))}
              {/* Add cell */}
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center gap-1.5 cursor-pointer"
                onClick={openAdd}
              >
                <div className="flex items-center justify-center rounded-full border-2 border-dashed border-gray-300 dark:border-gray-600"
                  style={{ width: 110, height: 110 }}>
                  <Plus size={28} className="text-gray-300 dark:text-gray-600" />
                </div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                  {t('Добавить', 'Add')}
                </div>
              </motion.div>
            </div>

            {/* All done */}
            <AnimatePresence>
              {doneCount === total && total > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-6 p-4 rounded-2xl bg-green-50 dark:bg-green-900/15 border border-green-200/50 dark:border-green-800/30 text-center"
                >
                  <Trophy size={24} className="text-green-500 mx-auto mb-1" />
                  <p className="text-sm font-bold text-green-600 dark:text-green-400">{t('Все привычки выполнены!', 'All habits done!')}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>

      {/* Add/Edit Modal — full screen */}
      {modal && (
        <div className="fixed inset-0 z-50 bg-white dark:bg-gray-900">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700/50">
            <button onClick={() => setModal(null)} className="text-sm text-gray-500 dark:text-gray-400 font-medium">
              {t('Отмена', 'Cancel')}
            </button>
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">
              {modal === 'edit' ? t('Редактировать', 'Edit') : t('Новая привычка', 'New habit')}
            </h2>
            <button onClick={save} disabled={!title.trim()}
              className="text-sm text-indigo-600 font-bold disabled:text-gray-300 dark:disabled:text-gray-600">
              {modal === 'edit' ? t('Сохранить', 'Save') : t('Создать', 'Create')}
            </button>
          </div>

          <div className="overflow-auto px-4 py-4 space-y-5" style={{ height: 'calc(100vh - 56px)' }}>
            {/* Preview */}
            <div className="flex items-center gap-3 p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/80 border border-gray-100 dark:border-gray-700/50">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{ background: `linear-gradient(135deg, ${color}25, ${color}10)`, color }}>
                <HIcon icon={icon} size={24} />
              </div>
              <div>
                <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">{title || t('Название привычки', 'Habit name')}</div>
                <div className="text-xs text-gray-400">{FREQS.find(f => f.v === freq)?.l[t('0','1') === '0' ? 0 : 1]}</div>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">{t('Название', 'Title')}</label>
              <input autoFocus className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-2xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                placeholder={t('Например: Медитация', 'E.g.: Meditation')} value={title} onChange={e => setTitle(e.target.value)} />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 block">{t('Иконка', 'Icon')}</label>
              <div className="grid grid-cols-5 gap-2">
                {ICONS.map(({ icon: ic, l }) => (
                  <button key={ic} onClick={() => { setIcon(ic); if (!title) setTitle(t(l[0]!, l[1]!)); }}
                    className={`aspect-square rounded-2xl flex flex-col items-center justify-center gap-0.5 transition-all ${
                      icon === ic ? 'ring-2 ring-indigo-500 shadow-md' : 'bg-gray-50 dark:bg-gray-800 active:scale-95'
                    }`}
                    style={icon === ic ? { color, backgroundColor: color + '12' } : undefined}>
                    <HIcon icon={ic} size={22} className={icon !== ic ? 'text-gray-400 dark:text-gray-500' : ''} />
                    <span className={`text-[9px] leading-tight ${icon === ic ? 'font-medium' : 'text-gray-400'}`}>{t(l[0]!, l[1]!)}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 block">{t('Цвет', 'Color')}</label>
              <div className="flex gap-3">
                {COLORS.map(c => (
                  <button key={c} onClick={() => setColor(c)}
                    className={`w-10 h-10 rounded-2xl transition-all ${color === c ? 'ring-2 ring-offset-2 ring-gray-400 dark:ring-offset-gray-900 scale-110' : 'active:scale-90'}`}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 block">{t('Частота', 'Frequency')}</label>
              <div className="grid grid-cols-2 gap-2">
                {FREQS.map(f => (
                  <button key={f.v} onClick={() => setFreq(f.v)}
                    className={`py-3 rounded-2xl text-sm font-medium transition-all ${
                      freq === f.v ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 active:scale-95'
                    }`}>
                    {t(f.l[0]!, f.l[1]!)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5">
                <Clock size={12} /> {t('Напоминание в Telegram', 'Telegram reminder')}
              </label>
              <div className="flex items-center gap-2">
                <input type="time" className="flex-1 px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-2xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 text-sm focus:outline-none"
                  value={remind} onChange={e => setRemind(e.target.value)} />
                {remind && <button onClick={() => setRemind('')} className="p-2 text-gray-400 hover:text-gray-600"><X size={16} /></button>}
              </div>
            </div>

            {modal === 'edit' && (
              <button onClick={remove}
                className="w-full py-3 rounded-2xl text-red-500 text-sm font-medium border border-red-200 dark:border-red-800/50 flex items-center justify-center gap-2 active:scale-95 transition-all">
                <Trash2 size={16} /> {t('Удалить привычку', 'Delete habit')}
              </button>
            )}

            <div className="h-8" />
          </div>
        </div>
      )}
    </div>
  );
}
