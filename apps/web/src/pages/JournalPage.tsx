import { useState, useEffect } from 'react';
import { apiGet, apiPost, apiPatch } from '../api/client';

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
  { value: 1, emoji: '😫', label: 'Тяжело' },
  { value: 2, emoji: '😕', label: 'Так себе' },
  { value: 3, emoji: '😐', label: 'Нормально' },
  { value: 4, emoji: '🙂', label: 'Хорошо' },
  { value: 5, emoji: '🔥', label: 'Отлично' },
];

export function JournalPage() {
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
    <div className="flex flex-col h-full pb-20">
      <div className="page-header flex items-center justify-between px-4 pt-4 pb-2 border-b dark:border-gray-700">
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">📓 Ежедневник</h1>
        <div className="text-xs text-gray-400">{saving ? 'Сохранение...' : '✓ Сохранено'}</div>
      </div>

      {/* Date selector — horizontal scroll */}
      <div className="flex gap-2 px-4 py-3 overflow-x-auto">
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
      <div className="flex-1 overflow-auto px-4 space-y-4">
        {/* Mood */}
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">Настроение</div>
          <div className="flex gap-2">
            {MOODS.map(m => (
              <button key={m.value} onClick={() => { setForm(f => ({ ...f, mood: m.value })); setTimeout(save, 100); }}
                className={`flex-1 flex flex-col items-center py-2 rounded-xl transition-all ${
                  form.mood === m.value ? 'bg-indigo-100 dark:bg-indigo-900/40 ring-2 ring-indigo-500' : 'bg-gray-50 dark:bg-gray-800'
                }`}>
                <span className="text-2xl">{m.emoji}</span>
                <span className="text-[10px] text-gray-500 mt-1">{m.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Focus */}
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">🎯 Фокус дня</div>
          <textarea className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 resize-none focus:outline-none focus:border-indigo-300"
            rows={2} placeholder="На чём сфокусируюсь сегодня..."
            value={form.focus} onChange={e => setForm(f => ({ ...f, focus: e.target.value }))} onBlur={handleBlur} />
        </div>

        {/* Gratitude */}
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">🙏 Благодарность</div>
          <textarea className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 resize-none focus:outline-none focus:border-indigo-300"
            rows={2} placeholder="За что благодарен..."
            value={form.gratitude} onChange={e => setForm(f => ({ ...f, gratitude: e.target.value }))} onBlur={handleBlur} />
        </div>

        {/* Notes */}
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">📝 Заметки</div>
          <textarea className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 resize-none focus:outline-none focus:border-indigo-300"
            rows={3} placeholder="Мысли, идеи, размышления..."
            value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} onBlur={handleBlur} />
        </div>

        {/* Results */}
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">✅ Итоги дня</div>
          <textarea className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 resize-none focus:outline-none focus:border-indigo-300"
            rows={2} placeholder="Что удалось сделать..."
            value={form.results} onChange={e => setForm(f => ({ ...f, results: e.target.value }))} onBlur={handleBlur} />
        </div>
      </div>
    </div>
  );
}
