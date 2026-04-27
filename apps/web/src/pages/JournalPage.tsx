import { useState, useEffect } from 'react';
import { apiGet, apiPost, apiPatch } from '../api/client';
import { useLangStore } from '../store/lang.store';
import { BookOpen } from 'lucide-react';

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

export function JournalPage() {
  const { t } = useLangStore();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [selectedDate, setSelectedDate] = useState(getToday());
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ focus: '', gratitude: '', notes: '', results: '', mood: 3 });

  const recentDates = getRecentDates(14);
  const today = getToday();

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
  }, [selectedDate, entries]);

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

  const handleBlur = () => { save(); };

  const entryDates = new Set(entries.map(e => e.date));

  return (
    <div className="relative overflow-hidden flex flex-col h-full pb-20">
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full border-4 border-indigo-400/30 dark:border-white/[0.12]" style={{ animation: 'circleLeft 16s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute -top-20 -right-20 w-[350px] h-[350px] rounded-full border-4 border-purple-400/35 dark:border-white/[0.12]" style={{ animation: 'circleLeftSlow 12s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] h-[500px] rounded-full bg-indigo-400/[0.14] dark:bg-white/[0.06] blur-[80px]" style={{ animation: 'circleRight 20s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="relative z-10 page-header flex items-center justify-between px-4 pt-4 pb-2 border-b dark:border-gray-700">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-pink-500 to-pink-600 flex items-center justify-center shadow-lg shadow-pink-500/25">
            <BookOpen size={20} className="text-white" />
          </div>
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('Ежедневник', 'Journal')}</h1>
        </div>
        <div className="text-xs text-gray-400">{saving ? t('Сохранение...', 'Saving...') : t('✓ Сохранено', '✓ Saved')}</div>
      </div>

      {/* Date selector — horizontal scroll */}
      <div className="relative z-10 flex gap-2 px-4 py-3 overflow-x-auto">
        {recentDates.map(date => {
          const d = new Date(date + 'T12:00:00');
          const dayName = d.toLocaleDateString('ru-RU', { weekday: 'short' });
          const dayNum = d.getDate();
          const isSelected = date === selectedDate;
          const hasEntry = entryDates.has(date);
          const isToday = date === today;

          return (
            <button key={date} onClick={() => setSelectedDate(date)}
              className={`flex flex-col items-center px-3 py-2 rounded-xl min-w-[48px] transition-all ${
                isSelected ? 'bg-indigo-600 text-white' : hasEntry ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600' : 'text-gray-500 dark:text-gray-400'
              }`}>
              <span className="text-[10px] uppercase">{dayName}</span>
              <span className={`text-lg font-bold ${isToday && !isSelected ? 'text-indigo-600' : ''}`}>{dayNum}</span>
              {hasEntry && !isSelected && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-0.5" />}
            </button>
          );
        })}
      </div>

      {/* Journal form */}
      <div className="relative z-10 flex-1 overflow-auto px-4 space-y-4">
        {/* Mood */}
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t('Настроение', 'Mood')}</div>
          <div className="flex gap-2">
            {MOODS.map(m => (
              <button key={m.value} onClick={() => { setForm(f => ({ ...f, mood: m.value })); setTimeout(save, 100); }}
                className={`flex-1 flex flex-col items-center py-2 rounded-xl transition-all ${
                  form.mood === m.value ? 'bg-indigo-100 dark:bg-indigo-900/40 ring-2 ring-indigo-500' : 'bg-gray-50 dark:bg-gray-800'
                }`}>
                <span className="text-2xl">{m.emoji}</span>
                <span className="text-[10px] text-gray-500 mt-1">{t(m.labelRu, m.labelEn)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Focus */}
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('🎯 Фокус дня', '🎯 Focus of the day')}</div>
          <textarea className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 resize-none focus:outline-none focus:border-indigo-300"
            rows={2} placeholder={t('На чём сфокусируюсь сегодня...', "What I'll focus on today...")}
            value={form.focus} onChange={e => setForm(f => ({ ...f, focus: e.target.value }))} onBlur={handleBlur} />
        </div>

        {/* Gratitude */}
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('🙏 Благодарность', '🙏 Gratitude')}</div>
          <textarea className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 resize-none focus:outline-none focus:border-indigo-300"
            rows={2} placeholder={t('За что благодарен...', 'What I am grateful for...')}
            value={form.gratitude} onChange={e => setForm(f => ({ ...f, gratitude: e.target.value }))} onBlur={handleBlur} />
        </div>

        {/* Notes */}
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('📝 Заметки', '📝 Notes')}</div>
          <textarea className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 resize-none focus:outline-none focus:border-indigo-300"
            rows={3} placeholder={t('Мысли, идеи, размышления...', 'Thoughts, ideas, reflections...')}
            value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} onBlur={handleBlur} />
        </div>

        {/* Results */}
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('✅ Итоги дня', '✅ Day results')}</div>
          <textarea className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 resize-none focus:outline-none focus:border-indigo-300"
            rows={2} placeholder={t('Что удалось сделать...', 'What got done today...')}
            value={form.results} onChange={e => setForm(f => ({ ...f, results: e.target.value }))} onBlur={handleBlur} />
        </div>
      </div>
    </div>
  );
}
