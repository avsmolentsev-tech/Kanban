import { useState, useEffect } from 'react';
import { apiGet, apiPost, apiPatch } from '../api/client';
import { useLangStore } from '../store/lang.store';
import { ChevronLeft, ChevronRight, Flame, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

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
  { value: 1, emoji: '😫', labelRu: 'Тяжело', labelEn: 'Rough', gradient: 'from-red-500 to-rose-600', bg: 'bg-red-50 dark:bg-red-900/15', ring: 'ring-red-400' },
  { value: 2, emoji: '😕', labelRu: 'Так себе', labelEn: 'Meh', gradient: 'from-orange-500 to-amber-600', bg: 'bg-orange-50 dark:bg-orange-900/15', ring: 'ring-orange-400' },
  { value: 3, emoji: '😐', labelRu: 'Нормально', labelEn: 'Okay', gradient: 'from-yellow-400 to-amber-500', bg: 'bg-yellow-50 dark:bg-yellow-900/15', ring: 'ring-yellow-400' },
  { value: 4, emoji: '🙂', labelRu: 'Хорошо', labelEn: 'Good', gradient: 'from-emerald-500 to-green-600', bg: 'bg-green-50 dark:bg-green-900/15', ring: 'ring-green-400' },
  { value: 5, emoji: '🔥', labelRu: 'Отлично', labelEn: 'Great', gradient: 'from-indigo-500 to-purple-600', bg: 'bg-indigo-50 dark:bg-indigo-900/15', ring: 'ring-indigo-400' },
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

export function JournalPage() {
  const { t, lang } = useLangStore();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [selectedDate, setSelectedDate] = useState(getToday());
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ focus: '', gratitude: '', notes: '', results: '', mood: 3 });
  const [completedTasks, setCompletedTasks] = useState<Array<{ title: string }>>([]);
  const [moodJustChanged, setMoodJustChanged] = useState(false);

  const recentDates = getRecentDates(14);
  const today = getToday();

  const prompts = lang === 'en' ? DAILY_PROMPTS_EN : DAILY_PROMPTS_RU;
  const dayOfYear = Math.floor((new Date(selectedDate).getTime() - new Date(selectedDate.slice(0, 4) + '-01-01').getTime()) / 86400000);
  const dailyPrompt = prompts[dayOfYear % prompts.length]!;

  useEffect(() => {
    apiGet<JournalEntry[]>('/journal').then(setEntries).catch(() => {});
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
    apiGet<Array<{ title: string; status: string; updated_at: string }>>('/tasks')
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

  // Count how many sections are filled
  const filledSections = [form.focus, form.gratitude, form.notes, form.results].filter(Boolean).length;

  return (
    <div className="relative overflow-hidden flex flex-col h-full pb-20">
      {/* Background decorations */}
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] hidden md:block h-[500px] rounded-full bg-indigo-400/15 dark:bg-indigo-400/[0.10]" style={{ animation: 'circleLeft 30s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] hidden md:block h-[500px] rounded-full bg-indigo-400/[0.14] dark:bg-violet-400/[0.09] blur-[80px]" style={{ animation: 'circleRight 34s cubic-bezier(0.45,0,0.55,1) infinite' }} />

      {/* Hero header with mood gradient */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="relative z-10 overflow-hidden"
      >
        {/* Mood gradient background */}
        <div className={`absolute inset-0 bg-gradient-to-br ${currentMood.gradient} opacity-[0.06] dark:opacity-[0.08] transition-all duration-700`} />

        <div className="relative px-4 pt-5 pb-4">
          {/* Top row: title + streak */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <motion.div
                key={form.mood}
                initial={{ scale: 0.8, rotate: -10 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', damping: 12 }}
                className="text-3xl"
              >
                {currentMood.emoji}
              </motion.div>
              <div>
                <h1 className="text-xl font-black text-gray-800 dark:text-white">{t('Дневник', 'Journal')}</h1>
                <div className="text-[11px] text-gray-400 flex items-center gap-1.5">
                  {saving ? (
                    <span className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
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

            {/* Streak badge */}
            {streak > 0 && (
              <motion.div
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20 rounded-2xl border border-orange-200/50 dark:border-orange-800/30"
              >
                <Flame size={16} className="text-orange-500 animate-pulse" />
                <span className="text-lg font-black text-orange-600 dark:text-orange-400">{streak}</span>
                <span className="text-[10px] text-orange-400 font-medium">{t('дн.', 'days')}</span>
              </motion.div>
            )}
          </div>

          {/* Mood selector — big emoji buttons */}
          <div className="flex gap-2 mb-1">
            {MOODS.map(m => (
              <motion.button
                key={m.value}
                whileTap={{ scale: 0.9 }}
                onClick={() => {
                  setForm(f => ({ ...f, mood: m.value }));
                  setMoodJustChanged(true);
                  setTimeout(() => { setMoodJustChanged(false); save(); }, 200);
                }}
                className={`flex-1 flex flex-col items-center py-3 rounded-2xl transition-all duration-300 cursor-pointer ${
                  form.mood === m.value
                    ? `bg-gradient-to-b ${m.gradient} shadow-lg`
                    : 'bg-white/60 dark:bg-gray-800/60 hover:bg-white dark:hover:bg-gray-700 border border-gray-200/50 dark:border-gray-700/50'
                }`}
              >
                <motion.span
                  animate={form.mood === m.value && moodJustChanged ? { scale: [1, 1.4, 1] } : {}}
                  transition={{ duration: 0.3 }}
                  className="text-2xl"
                >
                  {m.emoji}
                </motion.span>
                <span className={`text-[10px] mt-1 font-medium ${
                  form.mood === m.value ? 'text-white/90' : 'text-gray-400'
                }`}>
                  {t(m.labelRu, m.labelEn)}
                </span>
              </motion.button>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Date navigation */}
      <div className="relative z-10 flex items-center justify-between px-4 py-2 border-b border-gray-200/60 dark:border-gray-700/60">
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
                    : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 border border-transparent'
              }`}
            >
              {dayNum}
            </motion.button>
          );
        })}
      </div>

      {/* Content */}
      <div className="relative z-10 flex-1 overflow-auto px-4 space-y-4 pb-4">
        {/* Daily prompt */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-4 py-3.5 bg-gradient-to-r from-indigo-50/80 to-purple-50/80 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-2xl border border-indigo-200/40 dark:border-indigo-800/30 backdrop-blur-sm"
        >
          <div className="text-[10px] text-indigo-400 uppercase tracking-wider font-bold mb-1">
            {t('Вопрос дня', 'Question of the day')} ✨
          </div>
          <div className="text-sm text-indigo-700 dark:text-indigo-300 font-medium italic">
            {dailyPrompt}
          </div>
        </motion.div>

        {/* Progress indicator */}
        {filledSections > 0 && (
          <div className="flex items-center gap-2 px-1">
            <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(filledSections / 4) * 100}%` }}
                transition={{ duration: 0.5 }}
                className={`h-full rounded-full bg-gradient-to-r ${currentMood.gradient}`}
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
            className="bg-white/80 dark:bg-gray-800/60 rounded-2xl border border-gray-200/50 dark:border-gray-700/40 p-4 backdrop-blur-sm hover:border-indigo-200/50 dark:hover:border-indigo-700/30 transition-colors"
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
              className="rounded-2xl border border-green-200/50 dark:border-green-800/30 p-4 bg-gradient-to-br from-green-50/80 to-emerald-50/80 dark:from-green-900/10 dark:to-emerald-900/10 backdrop-blur-sm"
            >
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">✅</span>
                <span className="text-xs font-bold text-green-600 dark:text-green-400 uppercase tracking-wider">
                  {t('Выполнено задач', 'Tasks completed')}: {completedTasks.length}
                </span>
              </div>
              <div className="space-y-1.5">
                {completedTasks.map((tk, i) => (
                  <div key={i} className="flex items-center gap-2.5 text-sm text-green-700 dark:text-green-300">
                    <div className="w-5 h-5 rounded-lg bg-green-500/20 flex items-center justify-center flex-shrink-0">
                      <Check size={12} className="text-green-600 dark:text-green-400" />
                    </div>
                    <span>{tk.title}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
