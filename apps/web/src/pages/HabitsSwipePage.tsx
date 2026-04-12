import { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api/client';
import { useLangStore } from '../store/lang.store';
import { Flame, Plus, Check, Pencil, Trash2, X, Clock, Zap, Trophy } from 'lucide-react';

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

const ICON_CATEGORIES = [
  {
    labelRu: 'Здоровье', labelEn: 'Health',
    icons: [
      { icon: '🧘', labelRu: 'Медитация', labelEn: 'Meditation' },
      { icon: '🏋️', labelRu: 'Спорт', labelEn: 'Sport' },
      { icon: '🏃', labelRu: 'Бег', labelEn: 'Running' },
      { icon: '🚴', labelRu: 'Велосипед', labelEn: 'Cycling' },
      { icon: '🏊', labelRu: 'Плавание', labelEn: 'Swimming' },
      { icon: '🧗', labelRu: 'Скалолазание', labelEn: 'Climbing' },
      { icon: '💧', labelRu: 'Вода', labelEn: 'Water' },
      { icon: '🥗', labelRu: 'Питание', labelEn: 'Nutrition' },
      { icon: '😴', labelRu: 'Сон', labelEn: 'Sleep' },
      { icon: '💊', labelRu: 'Витамины', labelEn: 'Vitamins' },
      { icon: '🚶', labelRu: 'Прогулка', labelEn: 'Walk' },
      { icon: '🧖', labelRu: 'Уход', labelEn: 'Self-care' },
    ],
  },
  {
    labelRu: 'Развитие', labelEn: 'Growth',
    icons: [
      { icon: '📖', labelRu: 'Чтение', labelEn: 'Reading' },
      { icon: '✍️', labelRu: 'Письмо', labelEn: 'Writing' },
      { icon: '🧠', labelRu: 'Учёба', labelEn: 'Study' },
      { icon: '🎯', labelRu: 'Фокус', labelEn: 'Focus' },
      { icon: '📝', labelRu: 'Дневник', labelEn: 'Journal' },
      { icon: '🎧', labelRu: 'Подкасты', labelEn: 'Podcasts' },
    ],
  },
  {
    labelRu: 'Продуктивность', labelEn: 'Productivity',
    icons: [
      { icon: '⏰', labelRu: 'Ранний подъём', labelEn: 'Early rise' },
      { icon: '📵', labelRu: 'Без телефона', labelEn: 'No phone' },
      { icon: '🧹', labelRu: 'Уборка', labelEn: 'Cleaning' },
      { icon: '💰', labelRu: 'Финансы', labelEn: 'Finance' },
      { icon: '🎨', labelRu: 'Творчество', labelEn: 'Creativity' },
      { icon: '🙏', labelRu: 'Благодарность', labelEn: 'Gratitude' },
    ],
  },
];
const ICON_OPTIONS = ICON_CATEGORIES.flatMap(c => c.icons);
const COLOR_OPTIONS = ['#6366f1', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];
const FREQ_OPTIONS = [
  { value: 'daily', labelRu: 'Каждый день', labelEn: 'Every day' },
  { value: '2x_week', labelRu: '2 раза в неделю', labelEn: '2x a week' },
  { value: '3x_week', labelRu: '3 раза в неделю', labelEn: '3x a week' },
  { value: 'weekly', labelRu: 'Раз в неделю', labelEn: 'Once a week' },
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
  const { t } = useLangStore();
  const [sx, setSx] = useState(0);
  const [startX, setStartX] = useState<number | null>(null);
  const last14 = getLast14Days();
  const today = getToday();

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {!done && sx > 20 && (
        <div className="absolute inset-0 bg-gradient-to-r from-green-500 to-emerald-500 flex items-center pl-5 text-white font-bold text-sm rounded-2xl"
          style={{ opacity: Math.min(1, sx / 80) }}>
          <Check size={20} className="mr-2" /> {t('Готово', 'Done')}
        </div>
      )}
      <div
        className={`relative cursor-pointer transition-all ${
          done
            ? 'bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border border-green-200 dark:border-green-700/50'
            : 'bg-white dark:bg-gray-800/80 border border-gray-100 dark:border-gray-700/50'
        }`}
        style={{ transform: `translateX(${sx}px)`, transition: sx === 0 ? 'transform 0.2s ease-out' : 'none', borderRadius: '1rem' }}
        onTouchStart={(e) => { if (!done) setStartX(e.touches[0]!.clientX); }}
        onTouchMove={(e) => { if (startX === null || done) return; const dx = e.touches[0]!.clientX - startX; if (dx > 0) setSx(dx); }}
        onTouchEnd={() => { if (sx > 80 && !done) onToggle(); setSx(0); setStartX(null); }}
      >
        {/* Main row */}
        <div className="flex items-center gap-3 p-4" onClick={() => onToggle()}>
          <div className={`w-13 h-13 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0 transition-all ${
            done ? 'shadow-lg' : 'shadow-sm'
          }`}
            style={{
              background: done
                ? 'linear-gradient(135deg, #22c55e, #10b981)'
                : `linear-gradient(135deg, ${habit.color}22, ${habit.color}11)`,
              boxShadow: done ? '0 4px 14px rgba(34,197,94,0.3)' : `0 2px 8px ${habit.color}15`,
              width: 52, height: 52,
            }}>
            {done ? <Check size={24} className="text-white" strokeWidth={3} /> : habit.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className={`font-semibold text-[15px] ${done ? 'line-through text-green-700 dark:text-green-300' : 'text-gray-800 dark:text-gray-100'}`}>
              {habit.title}
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1.5">
              <Clock size={10} />
              {(() => { const fo = FREQ_OPTIONS.find(f => f.value === habit.frequency); return fo ? t(fo.labelRu, fo.labelEn) : habit.frequency; })()}
              {habit.remind_time && <><span className="text-gray-300">•</span> {habit.remind_time}</>}
            </div>
          </div>
          {habit.streak > 0 && (
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-orange-50 dark:bg-orange-900/20 flex-shrink-0">
              <Zap size={12} className="text-orange-500" fill="currentColor" />
              <span className="text-xs text-orange-600 dark:text-orange-400 font-bold">{habit.streak}</span>
            </div>
          )}
          <button onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="p-2 rounded-xl text-gray-300 hover:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex-shrink-0">
            <Pencil size={14} />
          </button>
        </div>

        {/* Mini calendar — last 14 days */}
        <div className="flex gap-[3px] px-4 pb-3">
          {last14.map(date => {
            const logged = logDates.has(date);
            const isToday = date === today;
            return (
              <div key={date} title={date}
                className={`flex-1 h-[6px] rounded-full transition-colors ${
                  logged ? 'shadow-sm' : isToday ? 'bg-gray-200 dark:bg-gray-600' : 'bg-gray-100 dark:bg-gray-700/50'
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
    if (!confirm(t('Удалить привычку?', 'Delete habit?'))) return;
    await apiDelete(`/habits/${id}`);
    setShowModal(false); setEditHabit(null); load();
  };

  const doneCount = habits.filter(h => doneIds.has(h.id)).length;
  const progress = habits.length > 0 ? (doneCount / habits.length) * 100 : 0;

  return (
    <div className="flex flex-col h-full pb-24">
      {/* Header */}
      <div className="px-4 pt-5 pb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center shadow-lg shadow-orange-500/25">
              <Flame size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('Привычки', 'Habits')}</h1>
              {habits.length > 0 && (
                <div className="text-xs text-gray-400">{doneCount} {t('из', 'of')} {habits.length} {t('сегодня', 'today')}</div>
              )}
            </div>
          </div>
          <button onClick={openCreate}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium shadow-lg shadow-indigo-500/25 transition-all active:scale-95">
            <Plus size={16} strokeWidth={2.5} />
            {t('Новая', 'New')}
          </button>
        </div>

        {/* Progress bar */}
        {habits.length > 0 && (
          <div className="relative">
            <div className="h-2.5 bg-gray-100 dark:bg-gray-700/50 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500 ease-out bg-gradient-to-r from-orange-500 to-red-500"
                style={{ width: `${progress}%` }} />
            </div>
            {progress === 100 && (
              <div className="absolute -right-1 -top-1">
                <Trophy size={14} className="text-orange-500" fill="currentColor" />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Habit list */}
      <div className="flex-1 overflow-auto px-4 space-y-2.5">
        {habits.length === 0 && (
          <div className="text-center py-16">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-orange-500/10 to-red-500/10 flex items-center justify-center mx-auto mb-4">
              <Flame size={36} className="text-orange-400" />
            </div>
            <div className="text-gray-500 dark:text-gray-400 font-medium">{t('Нет привычек', 'No habits yet')}</div>
            <div className="text-xs text-gray-400 mt-1">{t('Начни отслеживать свои привычки', 'Start tracking your habits')}</div>
            <button onClick={openCreate}
              className="mt-5 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium shadow-lg shadow-indigo-500/25">
              <Plus size={16} className="inline mr-1" /> {t('Добавить', 'Add')}
            </button>
          </div>
        )}

        {habits.map(h => (
          <SwipeHabitCard key={h.id} habit={h} done={doneIds.has(h.id)}
            logDates={logMap[h.id] || new Set()} onToggle={() => toggle(h.id)} onEdit={() => openEdit(h)} />
        ))}

        {doneCount === habits.length && habits.length > 0 && (
          <div className="text-center py-8">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-green-500/30">
              <Trophy size={28} className="text-white" />
            </div>
            <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('Все привычки выполнены!', 'All habits done!')}</div>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowModal(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-md max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
            {/* Handle bar (mobile) */}
            <div className="flex justify-center pt-3 sm:hidden">
              <div className="w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
            </div>

            <div className="p-5 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">
                  {editHabit ? t('Редактировать', 'Edit') : t('Новая привычка', 'New habit')}
                </h2>
                <button onClick={() => setShowModal(false)} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
                  <X size={18} />
                </button>
              </div>

              <input autoFocus className="w-full px-4 py-3.5 border border-gray-200 dark:border-gray-600 rounded-2xl bg-gray-50 dark:bg-gray-700/50 text-gray-800 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-400 transition-all"
                placeholder={t('Название', 'Title')} value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} />

              <div>
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">{t('Иконка', 'Icon')}</div>
                <div className="space-y-3 max-h-[200px] overflow-auto">
                  {ICON_CATEGORIES.map(cat => (
                    <div key={cat.labelEn}>
                      <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">{t(cat.labelRu, cat.labelEn)}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {cat.icons.map(({ icon: ic, labelRu, labelEn }) => (
                          <button key={ic} onClick={() => { setIcon(ic); if (!title) setTitle(t(labelRu, labelEn)); }}
                            title={t(labelRu, labelEn)}
                            className={`w-11 h-11 rounded-2xl flex items-center justify-center text-xl transition-all ${
                              icon === ic
                                ? 'ring-2 ring-indigo-500 bg-indigo-100 dark:bg-indigo-900/40 scale-110 shadow-md'
                                : 'bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 hover:scale-105'
                            }`}>
                            {ic}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">{t('Цвет', 'Color')}</div>
                <div className="flex gap-2.5">
                  {COLOR_OPTIONS.map(c => (
                    <button key={c} onClick={() => setColor(c)}
                      className={`w-10 h-10 rounded-2xl transition-all ${color === c ? 'ring-2 ring-offset-2 ring-gray-400 dark:ring-offset-gray-800 scale-110' : 'hover:scale-105'}`}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">{t('Частота', 'Frequency')}</div>
                <div className="grid grid-cols-2 gap-2">
                  {FREQ_OPTIONS.map(f => (
                    <button key={f.value} onClick={() => setFreq(f.value)}
                      className={`px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                        freq === f.value
                          ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25'
                          : 'bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}>
                      {t(f.labelRu, f.labelEn)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <Clock size={12} /> {t('Напоминание', 'Reminder')}
                </div>
                <input type="time" className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-2xl bg-gray-50 dark:bg-gray-700/50 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  value={remind} onChange={e => setRemind(e.target.value)} />
              </div>

              <div className="flex gap-3 pt-1">
                {editHabit && (
                  <button onClick={() => remove(editHabit.id)}
                    className="p-3 rounded-2xl text-red-500 border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                    <Trash2 size={18} />
                  </button>
                )}
                <button onClick={() => setShowModal(false)}
                  className="flex-1 py-3 rounded-2xl border border-gray-200 dark:border-gray-600 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                  {t('Отмена', 'Cancel')}
                </button>
                <button onClick={save} disabled={!title.trim()}
                  className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-sm font-semibold disabled:opacity-50 shadow-lg shadow-indigo-500/25 transition-all">
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
