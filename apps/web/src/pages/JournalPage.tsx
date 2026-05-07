import { useState, useEffect } from 'react';
import { apiGet, apiPost, apiPatch } from '../api/client';
import { useLangStore } from '../store/lang.store';
import { BookOpen, ChevronLeft, ChevronRight, Flame } from 'lucide-react';

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

  const recentDates = getRecentDates(14);
  const today = getToday();

  // Daily prompt based on date
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
    // Load completed tasks for this date
    apiGet<Array<{ title: string; status: string; updated_at: string }>>('/tasks')
      .then(tasks => {
        const done = tasks.filter(tk => tk.status === 'done' && tk.updated_at?.startsWith(selectedDate));
        setCompletedTasks(done.slice(0, 10));
      }).catch(() => setCompletedTasks([]));
  }, [selectedDate, entries]);

  // Calculate streak
  const entryDates = new Set(entries.map(e => e.date));
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (entryDates.has(ds)) streak++;
    else if (i > 0) break; // allow today to be missing
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

  return (
    <div className="relative overflow-hidden flex flex-col h-full pb-20">
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] hidden md:block h-[500px] rounded-full bg-indigo-400/15 dark:bg-indigo-400/[0.10]" style={{ animation: 'circleLeft 30s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] hidden md:block h-[500px] rounded-full bg-indigo-400/[0.14] dark:bg-violet-400/[0.09] blur-[80px]" style={{ animation: 'circleRight 34s cubic-bezier(0.45,0,0.55,1) infinite' }} />

      {/* Header */}
      <div className="relative z-10 px-4 pt-4 pb-2 border-b dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-pink-500 to-pink-600 flex items-center justify-center shadow-lg shadow-pink-500/25">
              <BookOpen size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('Дневник', 'Journal')}</h1>
              <div className="text-[10px] text-gray-400">{saving ? t('Сохранение...', 'Saving...') : t('Автосохранение', 'Auto-save')}</div>
            </div>
          </div>
          {/* Streak */}
          {streak > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 dark:bg-orange-900/20 rounded-xl">
              <Flame size={16} className="text-orange-500" />
              <span className="text-sm font-bold text-orange-600 dark:text-orange-400">{streak}</span>
              <span className="text-[10px] text-orange-400">{t('дн.', 'days')}</span>
            </div>
          )}
        </div>
      </div>

      {/* Date navigation */}
      <div className="relative z-10 flex items-center justify-between px-4 py-3">
        <button onClick={() => navigateDate(-1)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 cursor-pointer">
          <ChevronLeft size={20} />
        </button>
        <button onClick={() => setSelectedDate(today)} className="text-sm font-semibold text-gray-700 dark:text-gray-200 hover:text-indigo-600 cursor-pointer">
          {dateLabel}
        </button>
        <button onClick={() => navigateDate(1)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 cursor-pointer"
          disabled={selectedDate >= today}>
          <ChevronRight size={20} className={selectedDate >= today ? 'opacity-30' : ''} />
        </button>
      </div>

      {/* Date pills */}
      <div className="relative z-10 flex gap-1.5 px-4 pb-3 overflow-x-auto">
        {recentDates.slice(0, 7).map(date => {
          const d = new Date(date + 'T12:00:00');
          const dayNum = d.getDate();
          const isSelected = date === selectedDate;
          const hasEntry = entryDates.has(date);
          return (
            <button key={date} onClick={() => setSelectedDate(date)}
              className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold transition-all flex-shrink-0 cursor-pointer ${
                isSelected ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30' : hasEntry ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}>
              {dayNum}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="relative z-10 flex-1 overflow-auto px-4 space-y-4 pb-4">
        {/* Daily prompt */}
        <div className="px-4 py-3 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-xl border border-indigo-100 dark:border-indigo-800/30">
          <div className="text-[10px] text-indigo-400 uppercase tracking-wider mb-1">{t('Вопрос дня', 'Question of the day')}</div>
          <div className="text-sm text-indigo-700 dark:text-indigo-300 font-medium italic">{dailyPrompt}</div>
        </div>

        {/* Mood */}
        <div className="flex gap-2">
          {MOODS.map(m => (
            <button key={m.value} onClick={() => { setForm(f => ({ ...f, mood: m.value })); setTimeout(save, 100); }}
              className={`flex-1 flex flex-col items-center py-2.5 rounded-xl transition-all cursor-pointer ${
                form.mood === m.value
                  ? `bg-gradient-to-b ${m.color} text-white shadow-md`
                  : 'bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}>
              <span className="text-xl">{m.emoji}</span>
              <span className={`text-[10px] mt-0.5 ${form.mood === m.value ? 'text-white/80' : 'text-gray-400'}`}>{t(m.labelRu, m.labelEn)}</span>
            </button>
          ))}
        </div>

        {/* Cards */}
        <div className="bg-white dark:bg-gray-800/80 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">{t('Фокус дня', 'Focus of the day')}</div>
          <AutoTextarea value={form.focus} onChange={v => setForm(f => ({ ...f, focus: v }))} onBlur={save}
            placeholder={t('На чём сфокусируюсь...', "What I'll focus on...")} />
        </div>

        <div className="bg-white dark:bg-gray-800/80 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">{t('Благодарность', 'Gratitude')}</div>
          <AutoTextarea value={form.gratitude} onChange={v => setForm(f => ({ ...f, gratitude: v }))} onBlur={save}
            placeholder={t('За что благодарен...', 'What I am grateful for...')} />
        </div>

        <div className="bg-white dark:bg-gray-800/80 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">{t('Заметки', 'Notes')}</div>
          <AutoTextarea value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} onBlur={save} minRows={3}
            placeholder={t('Мысли, идеи, размышления...', 'Thoughts, ideas, reflections...')} />
        </div>

        <div className="bg-white dark:bg-gray-800/80 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">{t('Итоги дня', 'Day results')}</div>
          <AutoTextarea value={form.results} onChange={v => setForm(f => ({ ...f, results: v }))} onBlur={save}
            placeholder={t('Что удалось сделать...', 'What got done today...')} />
        </div>

        {/* Completed tasks */}
        {completedTasks.length > 0 && (
          <div className="bg-green-50 dark:bg-green-900/10 rounded-xl border border-green-100 dark:border-green-800/30 p-4">
            <div className="text-xs font-semibold text-green-600 dark:text-green-400 uppercase tracking-wider mb-2">
              {t('Выполнено задач', 'Tasks completed')}: {completedTasks.length}
            </div>
            <div className="space-y-1">
              {completedTasks.map((tk, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-green-700 dark:text-green-300">
                  <span className="text-green-500">✓</span>
                  <span>{tk.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
