import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
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
function getLast7(): string[] {
  const r: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    r.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return r;
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
  const last7 = getLast7();
  const dayLabels = [t('Пн','Mo'),t('Вт','Tu'),t('Ср','We'),t('Чт','Th'),t('Пт','Fr'),t('Сб','Sa'),t('Вс','Su')];

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
  const pct = total > 0 ? (doneCount / total) * 100 : 0;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="flex flex-col h-full pb-24 bg-gray-50 dark:bg-gray-900 relative overflow-hidden">
      {/* Animated decorative circles */}
      <style>{`
        @keyframes hDrift1 { 0%,100% { transform: translate(0,0); } 50% { transform: translate(-5px,7px); } }
        @keyframes hDrift2 { 0%,100% { transform: translate(0,0); } 50% { transform: translate(4px,-6px); } }
        @keyframes hDrift3 { 0%,100% { transform: translate(0,0); } 50% { transform: translate(6px,5px); } }
        @keyframes hDrift4 { 0%,100% { transform: translate(0,0); } 50% { transform: translate(-4px,-5px); } }
      `}</style>
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full border border-indigo-400/20 dark:border-indigo-400/[0.08]" style={{ animation: 'hDrift1 30s ease-in-out infinite' }} />
      <div className="pointer-events-none absolute -top-20 -right-20 w-[350px] h-[350px] rounded-full border border-purple-400/25 dark:border-purple-400/[0.08]" style={{ animation: 'hDrift2 26s ease-in-out infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] h-[500px] rounded-full bg-indigo-400/[0.08] dark:bg-indigo-400/[0.04] blur-[80px]" style={{ animation: 'hDrift3 34s ease-in-out infinite' }} />
      <div className="pointer-events-none absolute bottom-10 -left-24 w-[400px] h-[400px] rounded-full border border-purple-400/15 dark:border-purple-400/[0.06]" style={{ animation: 'hDrift4 28s ease-in-out infinite' }} />

      {/* Header with progress ring */}
      <div className="relative z-10 px-4 pt-5 pb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center shadow-lg shadow-orange-500/25">
              <Flame size={20} className="text-white" />
            </div>
            <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('Привычки', 'Habits')}</h1>
          </div>
          <button onClick={openAdd}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium shadow-lg shadow-indigo-500/25 active:scale-95 transition-all">
            <Plus size={16} strokeWidth={2.5} />
          </button>
        </div>

        {/* Progress ring */}
        {total > 0 && (
          <div className="flex items-center justify-center py-2">
            <div className="relative w-32 h-32">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r={radius} fill="none" stroke="currentColor"
                  className="text-gray-200 dark:text-gray-700" strokeWidth="8" />
                <circle cx="60" cy="60" r={radius} fill="none"
                  stroke="url(#ring-grad)" strokeWidth="8" strokeLinecap="round"
                  strokeDasharray={circumference} strokeDashoffset={offset}
                  className="transition-all duration-700 ease-out" />
                <defs>
                  <linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#f97316" />
                    <stop offset="100%" stopColor="#ef4444" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                {pct === 100
                  ? <Trophy size={28} className="text-orange-500 mb-0.5" />
                  : <span className="text-2xl font-bold text-gray-800 dark:text-gray-100">{doneCount}/{total}</span>
                }
                <span className="text-[10px] text-gray-400">{pct === 100 ? t('Всё!', 'Done!') : t('сегодня', 'today')}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Habit list */}
      <div className="relative z-10 flex-1 overflow-auto px-4 space-y-2">
        {total === 0 && (
          <div className="text-center py-16">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-orange-500/10 to-red-500/10 flex items-center justify-center mx-auto mb-4">
              <Flame size={36} className="text-orange-400" />
            </div>
            <div className="text-gray-500 dark:text-gray-400 font-medium">{t('Нет привычек', 'No habits')}</div>
            <button onClick={openAdd} className="mt-4 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium shadow-lg shadow-indigo-500/25">
              <Plus size={16} className="inline mr-1" /> {t('Добавить', 'Add')}
            </button>
          </div>
        )}

        {habits.map((h, i) => {
          const done = doneIds.has(h.id);
          const logs = logMap[h.id] || new Set();
          return (
            <motion.div
              key={h.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.2 }}
            >
            <div
              className={`flex items-center gap-3 p-3 rounded-2xl transition-all active:scale-[0.98] ${
                done
                  ? 'bg-green-50 dark:bg-green-900/15 border border-green-200 dark:border-green-800/40'
                  : 'bg-white dark:bg-gray-800/80 border border-gray-100 dark:border-gray-700/50'
              }`}>
              {/* Icon */}
              <motion.button
                onClick={() => toggle(h.id)}
                whileTap={{ scale: 0.88 }}
                animate={done ? { scale: [1, 1.15, 1] } : { scale: 1 }}
                transition={{ duration: 0.2 }}
                className="rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{
                  width: 48, height: 48,
                  background: done ? 'linear-gradient(135deg, #22c55e, #10b981)' : `linear-gradient(135deg, ${h.color}20, ${h.color}08)`,
                  color: done ? '#fff' : h.color,
                  boxShadow: done ? '0 4px 12px rgba(34,197,94,0.3)' : 'none',
                }}>
                {done ? <Check size={22} strokeWidth={3} /> : <HIcon icon={h.icon} size={22} />}
              </motion.button>

              {/* Title + dots */}
              <div className="flex-1 min-w-0" onClick={() => toggle(h.id)}>
                <div className={`text-sm font-semibold ${done ? 'line-through text-green-700 dark:text-green-400' : 'text-gray-800 dark:text-gray-100'}`}>
                  {h.title}
                </div>
                {/* 7-day dots */}
                <div className="flex gap-[3px] mt-1.5">
                  {last7.map((d, i) => {
                    const logged = logs.has(d);
                    const isToday = d === today;
                    return (
                      <div key={d} className="flex flex-col items-center" style={{ width: 18 }}>
                        <div className={`w-[14px] h-[14px] rounded-full transition-colors ${
                          logged ? 'shadow-sm' : isToday ? 'border-2 border-gray-300 dark:border-gray-500' : 'bg-gray-100 dark:bg-gray-700/50'
                        }`}
                          style={logged ? { backgroundColor: h.color } : undefined} />
                        <span className="text-[8px] text-gray-400 mt-0.5">{dayLabels[(new Date(d+'T12:00:00').getDay() + 6) % 7]}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Streak + edit */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {h.streak > 0 && (
                  <div className="flex items-center gap-0.5 px-2 py-1 rounded-full bg-orange-50 dark:bg-orange-900/20">
                    <Zap size={11} className="text-orange-500" fill="currentColor" />
                    <span className="text-[11px] text-orange-600 dark:text-orange-400 font-bold">{h.streak}</span>
                  </div>
                )}
                <button onClick={() => openEdit(h)}
                  className="p-1.5 rounded-lg text-gray-300 hover:text-gray-500 dark:hover:text-gray-400 transition-colors">
                  <Settings2 size={14} />
                </button>
              </div>
            </div>
            </motion.div>
          );
        })}

        {pct === 100 && total > 0 && (
          <div className="text-center py-4">
            <span className="text-sm text-green-600 dark:text-green-400 font-medium">{t('Все привычки выполнены!', 'All habits done!')}</span>
          </div>
        )}
      </div>

      {/* Add/Edit Modal — full screen on mobile */}
      {modal && (
        <div className="fixed inset-0 z-50 bg-white dark:bg-gray-900">
          {/* Top bar */}
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

          {/* Form */}
          <div className="overflow-auto px-4 py-4 space-y-5" style={{ height: 'calc(100vh - 56px)' }}>
            {/* Preview card */}
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

            {/* Name */}
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">{t('Название', 'Title')}</label>
              <input autoFocus className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-2xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                placeholder={t('Например: Медитация', 'E.g.: Meditation')} value={title} onChange={e => setTitle(e.target.value)} />
            </div>

            {/* Icon picker */}
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

            {/* Color picker */}
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

            {/* Frequency */}
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

            {/* Reminder */}
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

            {/* Delete button for edit */}
            {modal === 'edit' && (
              <button onClick={remove}
                className="w-full py-3 rounded-2xl text-red-500 text-sm font-medium border border-red-200 dark:border-red-800/50 flex items-center justify-center gap-2 active:scale-95 transition-all">
                <Trash2 size={16} /> {t('Удалить привычку', 'Delete habit')}
              </button>
            )}

            {/* Bottom padding */}
            <div className="h-8" />
          </div>
        </div>
      )}
    </div>
  );
}
