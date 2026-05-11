import { useState, useEffect } from 'react';
import { apiGet, apiPost, apiPatch } from '../api/client';
import { useLangStore } from '../store/lang.store';
import { ChevronLeft, ChevronRight, Flame, Check, BookOpen } from 'lucide-react';
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
  { value: 1, emoji: '😫', labelRu: 'Тяжело', labelEn: 'Rough', color: 'from-red-400 to-red-500' },
  { value: 2, emoji: '😕', labelRu: 'Так себе', labelEn: 'Meh', color: 'from-orange-400 to-orange-500' },
  { value: 3, emoji: '😐', labelRu: 'Нормально', labelEn: 'Okay', color: 'from-yellow-400 to-yellow-500' },
  { value: 4, emoji: '🙂', labelRu: 'Хорошо', labelEn: 'Good', color: 'from-green-400 to-green-500' },
  { value: 5, emoji: '🔥', labelRu: 'Отлично', labelEn: 'Great', color: 'from-indigo-400 to-purple-500' },
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
  { key: 'focus', emoji: '🎯', labelRu: 'Фокус дня', labelEn: 'Focus of the day', placeholderRu: 'На чём сфокусируюсь...', placeholderEn: "What I'll focus on..." },
  { key: 'gratitude', emoji: '🙏', labelRu: 'Благодарность', labelEn: 'Gratitude', placeholderRu: 'За что благодарен...', placeholderEn: 'What I am grateful for...' },
  { key: 'notes', emoji: '💭', labelRu: 'Заметки', labelEn: 'Notes', placeholderRu: 'Мысли, идеи, размышления...', placeholderEn: 'Thoughts, ideas, reflections...' },
  { key: 'results', emoji: '🏆', labelRu: 'Итоги дня', labelEn: 'Day results', placeholderRu: 'Что удалось сделать...', placeholderEn: 'What got done today...' },
] as const;

function AutoTextarea({ value, onChange, onBlur, placeholder, minRows = 2 }: {
  value: string; onChange: (v: string) => void; onBlur: () => void; placeholder: string; minRows?: number;
}) {
  return (
    <textarea
      className="w-full text-sm bg-transparent text-gray-800 dark:text-gray-100 resize-none focus:outline-none placeholder-gray-400 dark:placeholder-gray-600 leading-relaxed"
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
  const size = 90;
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - mood / 5);
  const currentMood = MOODS.find(m => m.value === mood)!;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius}
          fill="none" strokeWidth={stroke} className="stroke-gray-200 dark:stroke-gray-700" />
        <circle cx={size / 2} cy={size / 2} r={radius}
          fill="none" strokeWidth={stroke} strokeLinecap="round"
          stroke="url(#moodGradient)"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: 'stroke-dashoffset 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
            filter: 'drop-shadow(0 0 6px rgba(99,102,241,0.3))',
          }}
        />
        <defs>
          <linearGradient id="moodGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#818cf8" />
            <stop offset="100%" stopColor="#a78bfa" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <motion.span
          key={mood}
          initial={{ scale: 0.6 }}
          animate={{ scale: 1 }}
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
    <div className="relative overflow-hidden flex flex-col h-full pb-20">
      {/* Background decorations */}
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] hidden md:block h-[500px] rounded-full bg-indigo-400/15 dark:bg-indigo-400/[0.10]" style={{ animation: 'circleLeft 30s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] hidden md:block h-[500px] rounded-full bg-indigo-400/[0.14] dark:bg-violet-400/[0.09] blur-[80px]" style={{ animation: 'circleRight 34s cubic-bezier(0.45,0,0.55,1) infinite' }} />

      {/* Header */}
      <div className="relative z-10 px-4 pt-4 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-pink-500 to-pink-600 flex items-center justify-center shadow-lg shadow-pink-500/25">
              <BookOpen size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('Дневник', 'Journal')}</h1>
              <div className="text-[10px] text-gray-400 flex items-center gap-1">
                {saving ? (
                  <span className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    {t('Сохранение...', 'Saving...')}
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <Check size={10} className="text-green-500" />
                    {t('Автосохранение', 'Auto-save')}
                  </span>
                )}
              </div>
            </div>
          </div>
          {streak > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 dark:bg-orange-900/20 rounded-xl border border-orange-200/50 dark:border-orange-800/30">
              <Flame size={16} className="text-orange-500 animate-pulse" />
              <span className="text-sm font-bold text-orange-600 dark:text-orange-400">{streak}</span>
              <span className="text-[10px] text-orange-400">{t('дн.', 'days')}</span>
            </div>
          )}
        </div>
      </div>

      {/* Mood section — ring + buttons */}
      <div className="relative z-10 px-4 py-4 flex items-center gap-4">
        <MoodRing mood={form.mood} />
        <div className="flex-1 flex gap-2">
          {MOODS.map(m => (
            <motion.button
              key={m.value}
              whileTap={{ scale: 0.85 }}
              onClick={() => {
                setForm(f => ({ ...f, mood: m.value }));
                setMoodJustChanged(true);
                setTimeout(() => { setMoodJustChanged(false); save(); }, 200);
              }}
              className={`flex-1 flex flex-col items-center py-2.5 rounded-xl transition-all cursor-pointer ${
                form.mood === m.value
                  ? `bg-gradient-to-b ${m.color} text-white shadow-md`
                  : 'bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <motion.span
                animate={form.mood === m.value && moodJustChanged ? { scale: [1, 1.3, 1] } : {}}
                transition={{ duration: 0.3 }}
                className="text-xl"
              >
                {m.emoji}
              </motion.span>
              <span className={`text-[9px] mt-0.5 font-semibold ${
                form.mood === m.value ? 'text-white/80' : 'text-gray-400'
              }`}>
                {t(m.labelRu, m.labelEn)}
              </span>
            </motion.button>
          ))}
        </div>
      </div>

      {/* Date navigation */}
      <div className="relative z-10 flex items-center justify-between px-4 py-2 border-t border-b border-gray-200/60 dark:border-gray-700/60">
        <button onClick={() => navigateDate(-1)} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 cursor-pointer transition-colors">
          <ChevronLeft size={20} />
        </button>
        <button onClick={() => setSelectedDate(today)} className="text-sm font-bold text-gray-700 dark:text-gray-200 hover:text-indigo-600 cursor-pointer transition-colors">
          {dateLabel}
        </button>
        <button onClick={() => navigateDate(1)} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 cursor-pointer transition-colors"
          disabled={selectedDate >= today}>
          <ChevronRight size={20} className={selectedDate >= today ? 'opacity-30' : ''} />
        </button>
      </div>

      {/* Date pills */}
      <div className="relative z-10 flex gap-1.5 px-4 py-3 overflow-x-auto">
        {[...recentDates.slice(0, 7)].reverse().map(date => {
          const d = new Date(date + 'T12:00:00');
          const dayNum = d.getDate();
          const isSelected = date === selectedDate;
          const hasEntry = entryDates.has(date);
          return (
            <motion.button
              key={date}
              whileTap={{ scale: 0.9 }}
              onClick={() => setSelectedDate(date)}
              className={`w-10 h-10 rounded-2xl flex items-center justify-center text-xs font-bold transition-all flex-shrink-0 cursor-pointer ${
                isSelected
                  ? 'bg-gradient-to-b from-indigo-500 to-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                  : hasEntry
                    ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border border-indigo-200/50 dark:border-indigo-800/30'
                    : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {dayNum}
            </motion.button>
          );
        })}
      </div>

      {/* Content */}
      <div className="relative z-10 flex-1 overflow-auto px-4 space-y-3 pb-4">
        {/* Daily prompt */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-4 py-3 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-2xl border border-indigo-100 dark:border-indigo-800/30"
        >
          <div className="text-[10px] text-indigo-400 uppercase tracking-wider font-bold mb-1">
            {t('Вопрос дня', 'Question of the day')} ✨
          </div>
          <div className="text-sm text-indigo-700 dark:text-indigo-300 font-medium italic">{dailyPrompt}</div>
        </motion.div>

        {/* Progress */}
        {filledSections > 0 && (
          <div className="flex items-center gap-2 px-1">
            <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(filledSections / 4) * 100}%` }}
                transition={{ duration: 0.5 }}
                className={`h-full rounded-full bg-gradient-to-r ${currentMood.color}`}
              />
            </div>
            <span className="text-[10px] text-gray-400 font-medium">{filledSections}/4</span>
          </div>
        )}

        {/* Section cards with emojis */}
        {SECTIONS.map((section, idx) => (
          <motion.div
            key={section.key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            className="bg-white dark:bg-gray-800/80 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 hover:border-indigo-200 dark:hover:border-indigo-700/40 transition-colors"
          >
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-lg">{section.emoji}</span>
              <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {t(section.labelRu, section.labelEn)}
              </span>
              {form[section.key] && (
                <Check size={12} className="text-green-500 ml-auto" />
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

        {/* Completed tasks */}
        <AnimatePresence>
          {completedTasks.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-green-50 dark:bg-green-900/10 rounded-2xl border border-green-100 dark:border-green-800/30 p-4"
            >
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">✅</span>
                <span className="text-xs font-bold text-green-600 dark:text-green-400 uppercase tracking-wider">
                  {t('Выполнено задач', 'Tasks completed')}: {completedTasks.length}
                </span>
              </div>
              <div className="space-y-1.5">
                {completedTasks.map((tk) => (
                  <button
                    key={tk.id}
                    onClick={() => setSelectedTask(tk)}
                    className="w-full flex items-center gap-2.5 text-sm text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/20 rounded-lg px-2 py-1 -mx-2 transition-colors cursor-pointer text-left"
                  >
                    <div className="w-5 h-5 rounded-lg bg-green-500/20 flex items-center justify-center flex-shrink-0">
                      <Check size={12} className="text-green-600 dark:text-green-400" />
                    </div>
                    <span className="flex-1 truncate">{tk.title}</span>
                    <ChevronRight size={14} className="text-green-400 flex-shrink-0" />
                  </button>
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
            // Refresh completed tasks
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
    </div>
  );
}
