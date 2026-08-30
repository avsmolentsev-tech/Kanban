import { useState, useEffect } from 'react';
import { apiGet, apiPost, apiPatch } from '../api/client';
import { useLangStore } from '../store/lang.store';
import { ChevronLeft, ChevronRight, Flame, Check, BookOpen, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { TaskDetailPanel } from '../components/kanban/TaskDetailPanel';
import type { Task, Project, Person } from '@pis/shared';

interface JournalEntry {
  id: number;
  date: string;
  focus: string;
  gratitude: string;
  notes: string;
  results: string;
  mood: number;
}

function getToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getRecentDates(count: number): string[] {
  const dates: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return dates;
}

const MOODS = [
  { value: 1, emoji: '😫', labelRu: 'Тяжело', labelEn: 'Rough', gradient: 'from-red-400 to-rose-500', bg: 'bg-red-50 dark:bg-red-900/20', ring: 'ring-red-300' },
  { value: 2, emoji: '😕', labelRu: 'Так себе', labelEn: 'Meh', gradient: 'from-orange-400 to-amber-500', bg: 'bg-orange-50 dark:bg-orange-900/20', ring: 'ring-orange-300' },
  { value: 3, emoji: '😐', labelRu: 'Нормально', labelEn: 'Okay', gradient: 'from-yellow-400 to-yellow-500', bg: 'bg-yellow-50 dark:bg-yellow-900/20', ring: 'ring-yellow-300' },
  { value: 4, emoji: '🙂', labelRu: 'Хорошо', labelEn: 'Good', gradient: 'from-emerald-400 to-green-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20', ring: 'ring-emerald-300' },
  { value: 5, emoji: '🔥', labelRu: 'Отлично', labelEn: 'Great', gradient: 'from-violet-500 to-purple-600', bg: 'bg-violet-50 dark:bg-violet-900/20', ring: 'ring-violet-300' },
];

const DAILY_PROMPTS_RU = [
  'Какая главная победа сегодня?',
  'Что вдохновило тебя сегодня?',
  'Какой урок ты извлёк?',
  'За что ты благодарен прямо сейчас?',
  'Что бы ты сделал иначе?',
  'Кому ты помог сегодня?',
  'Что приближает тебя к цели?',
];

const DAILY_PROMPTS_EN = [
  'What was your biggest win today?',
  'What inspired you today?',
  'What lesson did you learn?',
  'What are you grateful for right now?',
  'What would you do differently?',
  'Who did you help today?',
  'What moved you closer to your goal?',
];

const SECTIONS = [
  { key: 'focus', emoji: '🎯', labelRu: 'Фокус дня', labelEn: 'Focus of the day', placeholderRu: 'На чём сфокусируюсь...', placeholderEn: "What I'll focus on...", bg: 'bg-indigo-50 dark:bg-indigo-950/30', border: 'border-indigo-200/60 dark:border-indigo-800/40', accent: 'text-indigo-600 dark:text-indigo-400', iconBg: 'bg-indigo-100 dark:bg-indigo-900/40' },
  { key: 'gratitude', emoji: '🙏', labelRu: 'Благодарность', labelEn: 'Gratitude', placeholderRu: 'За что благодарен...', placeholderEn: 'What I am grateful for...', bg: 'bg-pink-50 dark:bg-pink-950/30', border: 'border-pink-200/60 dark:border-pink-800/40', accent: 'text-pink-600 dark:text-pink-400', iconBg: 'bg-pink-100 dark:bg-pink-900/40' },
  { key: 'notes', emoji: '💭', labelRu: 'Заметки', labelEn: 'Notes', placeholderRu: 'Мысли, идеи, размышления...', placeholderEn: 'Thoughts, ideas, reflections...', bg: 'bg-purple-50 dark:bg-purple-950/30', border: 'border-purple-200/60 dark:border-purple-800/40', accent: 'text-purple-600 dark:text-purple-400', iconBg: 'bg-purple-100 dark:bg-purple-900/40' },
  { key: 'results', emoji: '🏆', labelRu: 'Итоги дня', labelEn: 'Day results', placeholderRu: 'Что удалось сделать...', placeholderEn: 'What got done today...', bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200/60 dark:border-emerald-800/40', accent: 'text-emerald-600 dark:text-emerald-400', iconBg: 'bg-emerald-100 dark:bg-emerald-900/40' },
] as const;

function AutoTextarea({ value, onChange, onBlur, placeholder, minRows = 2 }: {
  value: string; onChange: (v: string) => void; onBlur: () => void; placeholder: string; minRows?: number;
}) {
  return (
    <textarea
      className="w-full text-sm bg-transparent text-gray-800 dark:text-gray-100 resize-none focus:outline-none placeholder-gray-300 dark:placeholder-gray-600 leading-relaxed tracking-wide"
      rows={minRows}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onInput={(e) => { const el = e.target as HTMLTextAreaElement; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }}
      ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }}
    />
  );
}

/* ── Mood Ring ── */
function MoodRing({ mood }: { mood: number }) {
  const size = 80;
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - mood / 5);
  const currentMood = MOODS.find(m => m.value === mood)!;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius}
          fill="none" strokeWidth={stroke} className="stroke-white/30" />
        <circle cx={size / 2} cy={size / 2} r={radius}
          fill="none" strokeWidth={stroke} strokeLinecap="round"
          stroke="white"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: 'stroke-dashoffset 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
            filter: 'drop-shadow(0 0 8px rgba(255,255,255,0.4))',
          }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <motion.span
          key={mood}
          initial={{ scale: 0.6, rotate: -10 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', damping: 10 }}
          className="text-3xl"
        >
          {currentMood.emoji}
        </motion.span>
      </div>
    </div>
  );
}

export function JournalPage() {
  const { t, lang } = useLangStore();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [selectedDate, setSelectedDate] = useState(getToday());
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ focus: '', gratitude: '', notes: '', results: '', mood: 3 });
  const [completedTasks, setCompletedTasks] = useState<Task[]>([]);
  const [moodJustChanged, setMoodJustChanged] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  const recentDates = getRecentDates(14);
  const today = getToday();

  const prompts = lang === 'en' ? DAILY_PROMPTS_EN : DAILY_PROMPTS_RU;
  const dayOfYear = Math.floor((new Date(selectedDate).getTime() - new Date(selectedDate.slice(0, 4) + '-01-01').getTime()) / 86400000);
  const dailyPrompt = prompts[dayOfYear % prompts.length]!;

  useEffect(() => {
    apiGet<JournalEntry[]>('/journal').then(setEntries).catch(() => {});
    apiGet<Project[]>('/projects').then(setProjects).catch(() => {});
    apiGet<Person[]>('/people').then(setPeople).catch(() => {});
  }, []);

  useEffect(() => {
    const found = entries.find(e => e.date === selectedDate);
    if (found) {
      setEntry(found);
      setForm({ focus: found.focus, gratitude: found.gratitude, notes: found.notes, results: found.results, mood: found.mood });
    } else {
      setEntry(null);
      setForm({ focus: '', gratitude: '', notes: '', results: '', mood: 3 });
    }
    apiGet<Task[]>('/tasks')
      .then(tasks => {
        const done = tasks.filter(tk => tk.status === 'done' && tk.updated_at?.startsWith(selectedDate));
        setCompletedTasks(done.slice(0, 10));
      }).catch(() => setCompletedTasks([]));
  }, [selectedDate, entries]);

  const entryDates = new Set(entries.map(e => e.date));
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (entryDates.has(ds)) streak++;
    else if (i > 0) break;
  }

  const save = async () => {
    setSaving(true);
    try {
      if (entry) {
        await apiPatch(`/journal/${entry.id}`, form);
      } else {
        await apiPost('/journal', { ...form, date: selectedDate });
      }
      const updated = await apiGet<JournalEntry[]>('/journal');
      setEntries(updated);
    } catch {} finally { setSaving(false); }
  };

  const navigateDate = (dir: -1 | 1) => {
    const d = new Date(selectedDate + 'T12:00:00');
    d.setDate(d.getDate() + dir);
    setSelectedDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  };

  const selectedD = new Date(selectedDate + 'T12:00:00');
  const dateLabel = selectedDate === today
    ? t('Сегодня', 'Today')
    : selectedD.toLocaleDateString(lang === 'en' ? 'en-US' : 'ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

  const currentMood = MOODS.find(m => m.value === form.mood)!;
  const filledSections = [form.focus, form.gratitude, form.notes, form.results].filter(Boolean).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="relative overflow-hidden flex flex-col h-full pb-20"
    >
      {/* Background decorations */}
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] hidden md:block h-[500px] rounded-full bg-pink-400/10 dark:bg-pink-400/[0.06]" style={{ animation: 'circleLeft 30s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] hidden md:block h-[500px] rounded-full bg-violet-400/[0.10] dark:bg-violet-400/[0.06] blur-[80px]" style={{ animation: 'circleRight 34s cubic-bezier(0.45,0,0.55,1) infinite' }} />

      {/* ── Hero Header ── */}
      <div className="relative z-10 mx-4 mt-4 rounded-3xl bg-gradient-to-br from-pink-500 via-rose-500 to-violet-600 p-5 text-white overflow-hidden shadow-lg shadow-pink-500/20">
        <motion.div className="absolute -top-8 -right-8 w-28 h-28 bg-white/10 rounded-full" animate={{ y: [0, -6, 0] }} transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }} />
        <motion.div className="absolute -bottom-6 right-16 w-20 h-20 bg-white/5 rounded-full" animate={{ y: [0, 5, 0] }} transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 1 }} />

        <div className="flex items-center gap-4">
          <MoodRing mood={form.mood} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <BookOpen size={18} className="opacity-80" />
              <h1 className="text-xl font-extrabold tracking-tight">{t('Дневник', 'Journal')}</h1>
            </div>
            <p className="text-sm text-white/60 mt-0.5">
              {saving
                ? t('Сохранение...', 'Saving...')
                : <span className="flex items-center gap-1"><Check size={12} className="text-white/50" /> {t('Автосохранение', 'Auto-save')}</span>
              }
            </p>
            <div className="flex gap-2 mt-2.5">
              {streak > 0 && (
                <div className="flex items-center gap-1 px-2.5 py-1 bg-white/20 rounded-xl backdrop-blur-sm">
                  <Flame size={13} className="text-orange-300" />
                  <span className="text-xs font-bold">{streak}</span>
                  <span className="text-[10px] opacity-70">{t('дн.', 'days')}</span>
                </div>
              )}
              <div className="flex items-center gap-1 px-2.5 py-1 bg-white/20 rounded-xl backdrop-blur-sm">
                <span className="text-xs font-bold">{filledSections}/4</span>
              </div>
              <div className="flex items-center gap-1 px-2.5 py-1 bg-white/20 rounded-xl backdrop-blur-sm">
                <span className="text-xs font-bold">{entries.length}</span>
                <span className="text-[10px] opacity-70">{t('записей', 'entries')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Mood selector ── */}
      <div className="relative z-10 flex gap-2 px-4 pt-4 pb-2">
        {MOODS.map(m => (
          <motion.button
            key={m.value}
            whileTap={{ scale: 0.85 }}
            whileHover={{ y: -2 }}
            onClick={() => {
              setForm(f => ({ ...f, mood: m.value }));
              setMoodJustChanged(true);
              setTimeout(() => { setMoodJustChanged(false); save(); }, 200);
            }}
            className={`flex-1 flex flex-col items-center py-2.5 rounded-2xl transition-all cursor-pointer ${
              form.mood === m.value
                ? `bg-gradient-to-b ${m.gradient} text-white shadow-lg`
                : 'bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            <motion.span animate={form.mood === m.value && moodJustChanged ? { scale: [1, 1.4, 1], rotate: [0, 10, -10, 0] } : {}} transition={{ duration: 0.4 }} className="text-xl">
              {m.emoji}
            </motion.span>
            <span className={`text-[9px] mt-0.5 font-bold tracking-wide ${form.mood === m.value ? 'text-white/80' : 'text-gray-400'}`}>
              {t(m.labelRu, m.labelEn)}
            </span>
          </motion.button>
        ))}
      </div>

      {/* ── Date navigation ── */}
      <div className="relative z-10 flex items-center justify-between px-4 py-2">
        <button onClick={() => navigateDate(-1)} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 cursor-pointer transition-all active:scale-90">
          <ChevronLeft size={20} />
        </button>
        <button onClick={() => setSelectedDate(today)} className="text-sm font-bold text-gray-700 dark:text-gray-200 hover:text-pink-600 dark:hover:text-pink-400 cursor-pointer transition-colors tracking-wide">
          {dateLabel}
        </button>
        <button onClick={() => navigateDate(1)} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 cursor-pointer transition-all active:scale-90"
          disabled={selectedDate >= today}>
          <ChevronRight size={20} className={selectedDate >= today ? 'opacity-30' : ''} />
        </button>
      </div>

      {/* ── Date pills ── */}
      <div className="relative z-10 flex gap-1.5 px-4 pb-3 overflow-x-auto">
        {[...recentDates.slice(0, 7)].reverse().map((date, i) => {
          const d = new Date(date + 'T12:00:00');
          const dayNum = d.getDate();
          const dayName = d.toLocaleDateString(lang === 'en' ? 'en-US' : 'ru-RU', { weekday: 'short' }).slice(0, 2);
          const isSelected = date === selectedDate;
          const hasEntry = entryDates.has(date);
          return (
            <motion.button
              key={date}
              whileTap={{ scale: 0.9 }}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              onClick={() => setSelectedDate(date)}
              className={`flex flex-col items-center gap-0.5 w-12 py-2 rounded-2xl text-xs font-bold transition-all flex-shrink-0 cursor-pointer ${
                isSelected
                  ? 'bg-gradient-to-b from-pink-500 to-rose-600 text-white shadow-lg shadow-pink-500/30'
                  : hasEntry
                    ? 'bg-pink-50 dark:bg-pink-900/20 text-pink-600 dark:text-pink-400 ring-1 ring-pink-200/50 dark:ring-pink-800/30'
                    : 'text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <span className={`text-[9px] font-semibold uppercase ${isSelected ? 'text-white/70' : 'text-gray-300 dark:text-gray-600'}`}>{dayName}</span>
              <span>{dayNum}</span>
              {hasEntry && !isSelected && <div className="w-1 h-1 rounded-full bg-pink-400 mt-0.5" />}
            </motion.button>
          );
        })}
      </div>

      {/* ── Content ── */}
      <div className="relative z-10 flex-1 overflow-auto px-4 space-y-3 pb-4">
        {/* Daily prompt */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="relative px-4 py-3.5 bg-gradient-to-r from-violet-50 via-purple-50 to-pink-50 dark:from-violet-950/30 dark:via-purple-950/20 dark:to-pink-950/20 rounded-2xl border border-violet-200/50 dark:border-violet-800/30 overflow-hidden">
          <div className="absolute top-2 right-3 opacity-20"><Sparkles size={28} className="text-violet-400" /></div>
          <div className="text-[10px] text-violet-500 dark:text-violet-400 uppercase tracking-[0.15em] font-bold mb-1.5">
            {t('Вопрос дня', 'Question of the day')}
          </div>
          <div className="text-sm text-violet-700 dark:text-violet-300 font-semibold italic leading-relaxed">{dailyPrompt}</div>
        </motion.div>

        {/* Progress */}
        {filledSections > 0 && (
          <div className="flex items-center gap-2.5 px-1">
            <div className="flex-1 h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
              <motion.div initial={{ width: 0 }} animate={{ width: `${(filledSections / 4) * 100}%` }} transition={{ duration: 0.6, ease: 'easeOut' }}
                className={`h-full rounded-full bg-gradient-to-r ${currentMood.gradient}`} />
            </div>
            <span className="text-[10px] text-gray-400 font-bold tabular-nums">{filledSections}/4</span>
          </div>
        )}

        {/* ── Section cards ── */}
        {SECTIONS.map((section, idx) => (
          <motion.div key={section.key} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + idx * 0.06 }}
            className={`${section.bg} rounded-2xl border ${section.border} p-4 transition-all duration-200 hover:shadow-md`}>
            <div className="flex items-center gap-2.5 mb-3">
              <div className={`w-8 h-8 rounded-xl ${section.iconBg} flex items-center justify-center`}>
                <span className="text-base">{section.emoji}</span>
              </div>
              <span className={`text-xs font-extrabold ${section.accent} uppercase tracking-[0.12em]`}>
                {t(section.labelRu, section.labelEn)}
              </span>
              {form[section.key] && (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="ml-auto w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                  <Check size={11} className="text-emerald-600 dark:text-emerald-400" />
                </motion.div>
              )}
            </div>
            <AutoTextarea
              value={form[section.key]}
              onChange={v => setForm(f => ({ ...f, [section.key]: v }))}
              onBlur={save}
              minRows={section.key === 'notes' ? 3 : 2}
              placeholder={t(section.placeholderRu, section.placeholderEn)}
            />
          </motion.div>
        ))}

        {/* ── Completed tasks ── */}
        <AnimatePresence>
          {completedTasks.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
              className="bg-emerald-50 dark:bg-emerald-950/20 rounded-2xl border border-emerald-200/60 dark:border-emerald-800/30 p-4">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                  <span className="text-base">✅</span>
                </div>
                <span className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400 uppercase tracking-[0.12em]">
                  {t('Выполнено', 'Completed')}: {completedTasks.length}
                </span>
              </div>
              <div className="space-y-1">
                {completedTasks.map((tk, i) => (
                  <motion.button key={tk.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.45 + i * 0.04 }}
                    onClick={() => setSelectedTask(tk)}
                    className="w-full flex items-center gap-2.5 text-sm text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100/70 dark:hover:bg-emerald-900/20 rounded-xl px-2.5 py-1.5 -mx-1 transition-all cursor-pointer text-left active:scale-[0.98]">
                    <div className="w-5 h-5 rounded-lg bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                      <Check size={11} className="text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <span className="flex-1 truncate font-medium">{tk.title}</span>
                    <ChevronRight size={14} className="text-emerald-400 flex-shrink-0" />
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Task detail panel */}
      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          projects={projects}
          people={people}
          onClose={() => setSelectedTask(null)}
          onUpdated={() => {
            setSelectedTask(null);
            apiGet<Task[]>('/tasks')
              .then(tasks => {
                const done = tasks.filter(tk => tk.status === 'done' && tk.updated_at?.startsWith(selectedDate));
                setCompletedTasks(done.slice(0, 10));
              }).catch(() => {});
          }}
          onDeleted={() => {
            setSelectedTask(null);
            apiGet<Task[]>('/tasks')
              .then(tasks => {
                const done = tasks.filter(tk => tk.status === 'done' && tk.updated_at?.startsWith(selectedDate));
                setCompletedTasks(done.slice(0, 10));
              }).catch(() => {});
          }}
        />
      )}
    </motion.div>
  );
}
