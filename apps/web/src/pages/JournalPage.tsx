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
  { value: 1, emoji: '😫', labelRu: 'Тяжело', labelEn: 'Rough' },
  { value: 2, emoji: '😕', labelRu: 'Так себе', labelEn: 'Meh' },
  { value: 3, emoji: '😐', labelRu: 'Нормально', labelEn: 'Okay' },
  { value: 4, emoji: '🙂', labelRu: 'Хорошо', labelEn: 'Good' },
  { value: 5, emoji: '🔥', labelRu: 'Отлично', labelEn: 'Great' },
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
      className="w-full text-sm bg-transparent text-white resize-none focus:outline-none placeholder-white/30 leading-relaxed"
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
function MoodRing({ mood, onSelect }: { mood: number; onSelect: (v: number) => void }) {
  const { t } = useLangStore();
  const size = 100;
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - mood / 5);
  const currentMood = MOODS.find(m => m.value === mood)!;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius}
          fill="none" strokeWidth={stroke} className="stroke-white/15" />
        <circle cx={size / 2} cy={size / 2} r={radius}
          fill="none" strokeWidth={stroke} strokeLinecap="round"
          className="stroke-white"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: 'stroke-dashoffset 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
            filter: 'drop-shadow(0 0 6px rgba(255,255,255,0.4))',
          }}
        />
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
  const [completedTasks, setCompletedTasks] = useState<Array<{ title: string }>>([]);

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
  const filledSections = [form.focus, form.gratitude, form.notes, form.results].filter(Boolean).length;

  return (
    <div className="relative min-h-screen overflow-hidden pb-20">
      {/* Vibrant gradient background — matching Habits */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-purple-600 to-fuchsia-500" />
      {/* Animated orbs */}
      <div className="pointer-events-none absolute top-40 -right-20 w-[300px] h-[300px] rounded-full bg-pink-400/20 blur-[80px]" style={{ animation: 'circleLeft 32s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-20 w-[350px] h-[350px] rounded-full bg-blue-400/20 blur-[80px]" style={{ animation: 'circleRight 28s cubic-bezier(0.45,0,0.55,1) infinite' }} />

      {/* Hero header */}
      <div className="relative z-10 px-5 pt-5 pb-4">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-black text-white">{t('Дневник', 'Journal')}</h1>
            <div className="text-[11px] text-white/50 font-medium flex items-center gap-1.5 mt-0.5">
              {saving ? (
                <span className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse" />
                  {t('Сохранение...', 'Saving...')}
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <Check size={10} className="text-white/40" />
                  {t('Автосохранение', 'Auto-save')}
                </span>
              )}
            </div>
          </div>
          {streak > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl bg-white/10 backdrop-blur-sm">
              <Flame size={16} className="text-orange-300 animate-pulse" />
              <span className="text-lg font-black text-white">{streak}</span>
              <span className="text-[10px] text-white/50">{t('дн.', 'days')}</span>
            </div>
          )}
        </div>

        {/* Mood section — ring + buttons */}
        <div className="flex items-center gap-5 mb-2">
          <MoodRing mood={form.mood} onSelect={(v) => { setForm(f => ({ ...f, mood: v })); setTimeout(save, 200); }} />
          <div className="flex-1 flex gap-2">
            {MOODS.map(m => (
              <motion.button
                key={m.value}
                whileTap={{ scale: 0.85 }}
                onClick={() => { setForm(f => ({ ...f, mood: m.value })); setTimeout(save, 200); }}
                className={`flex-1 flex flex-col items-center py-2.5 rounded-2xl transition-all duration-300 cursor-pointer ${
                  form.mood === m.value
                    ? 'bg-white/25 backdrop-blur-sm shadow-lg shadow-white/10'
                    : 'bg-white/5 hover:bg-white/10'
                }`}
              >
                <motion.span
                  animate={form.mood === m.value ? { scale: [1, 1.2, 1] } : {}}
                  transition={{ duration: 0.3 }}
                  className="text-xl"
                >
                  {m.emoji}
                </motion.span>
                <span className={`text-[9px] mt-0.5 font-semibold ${
                  form.mood === m.value ? 'text-white' : 'text-white/30'
                }`}>
                  {t(m.labelRu, m.labelEn)}
                </span>
              </motion.button>
            ))}
          </div>
        </div>
      </div>

      {/* Date navigation */}
      <div className="relative z-10 flex items-center justify-between px-5 py-2">
        <button onClick={() => navigateDate(-1)} className="p-2 rounded-xl text-white/50 hover:text-white hover:bg-white/10 cursor-pointer transition-all">
          <ChevronLeft size={20} />
        </button>
        <button onClick={() => setSelectedDate(today)} className="text-sm font-bold text-white hover:text-white/80 cursor-pointer transition-colors">
          {dateLabel}
        </button>
        <button onClick={() => navigateDate(1)} className="p-2 rounded-xl text-white/50 hover:text-white hover:bg-white/10 cursor-pointer transition-all"
          disabled={selectedDate >= today}>
          <ChevronRight size={20} className={selectedDate >= today ? 'opacity-30' : ''} />
        </button>
      </div>

      {/* Date pills */}
      <div className="relative z-10 flex gap-1.5 px-5 py-2 overflow-x-auto">
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
              className={`w-10 h-10 rounded-2xl flex items-center justify-center text-xs font-bold flex-shrink-0 cursor-pointer transition-all ${
                isSelected
                  ? 'bg-white text-indigo-600 shadow-lg shadow-white/20'
                  : hasEntry
                    ? 'bg-white/20 text-white'
                    : 'text-white/30 hover:bg-white/10'
              }`}
            >
              {dayNum}
            </motion.button>
          );
        })}
      </div>

      {/* Content */}
      <div className="relative z-10 px-4 space-y-3 pt-4 pb-4">
        {/* Daily prompt */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-4 py-3 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/10"
        >
          <div className="text-[10px] text-white/40 uppercase tracking-wider font-bold mb-1">
            {t('Вопрос дня', 'Question of the day')} ✨
          </div>
          <div className="text-sm text-white/80 font-medium italic">{dailyPrompt}</div>
        </motion.div>

        {/* Progress */}
        {filledSections > 0 && (
          <div className="flex items-center gap-2 px-1">
            <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(filledSections / 4) * 100}%` }}
                transition={{ duration: 0.5 }}
                className="h-full rounded-full bg-white/60"
              />
            </div>
            <span className="text-[10px] text-white/40 font-medium">{filledSections}/4</span>
          </div>
        )}

        {/* Section cards */}
        {SECTIONS.map((section, idx) => (
          <motion.div
            key={section.key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            className="rounded-2xl bg-white/10 backdrop-blur-sm border border-white/10 p-4 hover:bg-white/[0.13] transition-colors"
          >
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-lg">{section.emoji}</span>
              <span className="text-xs font-bold text-white/50 uppercase tracking-wider">
                {t(section.labelRu, section.labelEn)}
              </span>
              {form[section.key] && (
                <Check size={12} className="text-white/40 ml-auto" />
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
              className="rounded-2xl bg-white/10 backdrop-blur-sm border border-white/10 p-4"
            >
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">✅</span>
                <span className="text-xs font-bold text-white/50 uppercase tracking-wider">
                  {t('Выполнено задач', 'Tasks completed')}: {completedTasks.length}
                </span>
              </div>
              <div className="space-y-1.5">
                {completedTasks.map((tk, i) => (
                  <div key={i} className="flex items-center gap-2.5 text-sm text-white/70">
                    <div className="w-5 h-5 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                      <Check size={12} className="text-white/50" />
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
