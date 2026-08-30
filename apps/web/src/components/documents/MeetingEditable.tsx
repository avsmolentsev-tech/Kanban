import { useState, useEffect, useRef } from 'react';
import { Calendar } from 'lucide-react';
import { useDocumentsStore } from '../../store/documents.store';
import { useLangStore } from '../../store/lang.store';
import type { SidebarMeeting } from '../../store/documents.store';

interface Props {
  meeting: SidebarMeeting;
}

export function MeetingEditable({ meeting }: Props) {
  const { t } = useLangStore();
  const { updateMeeting, setEditingMeeting } = useDocumentsStore();
  const [title, setTitle] = useState(meeting.title);
  const [date, setDate] = useState(meeting.date.split('T')[0]);
  const [summary, setSummary] = useState(meeting.summary_raw);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTitle(meeting.title);
    setDate(meeting.date.split('T')[0]);
    setSummary(meeting.summary_raw);
  }, [meeting.id]);

  const autoSave = (field: string, value: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      updateMeeting(meeting.id, { [field]: value });
    }, 2000);
  };

  return (
    <div className="px-8 py-6 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <input
          className="text-2xl font-bold bg-transparent text-gray-800 dark:text-gray-100 focus:outline-none placeholder-gray-400 w-full"
          value={title}
          onChange={(e) => { setTitle(e.target.value); autoSave('title', e.target.value); }}
          placeholder={t('Название встречи', 'Meeting title')}
        />
        <button
          onClick={() => setEditingMeeting(false)}
          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 ml-4 cursor-pointer flex-shrink-0"
        >
          {t('Готово', 'Done')}
        </button>
      </div>
      <div className="flex items-center gap-2 mb-6">
        <Calendar size={14} className="text-gray-400" />
        <input
          type="date"
          className="text-sm bg-transparent text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 focus:outline-none focus:border-indigo-500"
          value={date}
          onChange={(e) => { setDate(e.target.value); autoSave('date', e.target.value); }}
        />
      </div>
      <div>
        <div className="text-xs text-gray-500 mb-2">{t('Содержание', 'Content')}</div>
        <textarea
          className="w-full text-sm bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 focus:outline-none focus:border-indigo-500 resize-y"
          style={{ minHeight: '300px' }}
          rows={15}
          value={summary}
          onChange={(e) => { setSummary(e.target.value); autoSave('summary_raw', e.target.value); }}
          placeholder={t('Заметки встречи...', 'Meeting notes...')}
        />
      </div>
    </div>
  );
}
