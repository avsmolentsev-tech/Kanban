import { Calendar, Users, Download, FileText, ScrollText } from 'lucide-react';
import type { SidebarMeeting } from '../../store/documents.store';
import { useLangStore } from '../../store/lang.store';
import { useEffect, useState } from 'react';
import { apiGet, apiClient } from '../../api/client';

interface Person {
  id: number;
  name: string;
}

interface Agreement {
  id: number;
  description: string;
  status: string;
  due_date: string | null;
  person_id: number | null;
}

interface Props {
  meeting: SidebarMeeting;
}

function splitSummaryAndTranscript(raw: string): { summary: string; transcript: string } {
  // AI summary starts with ## headings, transcript follows after ---
  const separator = '\n\n---\n\n';
  const sepIdx = raw.indexOf(separator);
  if (sepIdx === -1) {
    // No separator — check if it starts with ## (pure summary) or is just transcript
    if (raw.startsWith('## ')) {
      return { summary: raw, transcript: '' };
    }
    return { summary: '', transcript: raw };
  }
  const before = raw.slice(0, sepIdx).trim();
  const after = raw.slice(sepIdx + separator.length).trim();
  // If before starts with ## it's summary + transcript
  if (before.startsWith('## ')) {
    return { summary: before, transcript: after };
  }
  // Otherwise it's all transcript (joined parts)
  return { summary: '', transcript: raw };
}

function DownloadButton({
  meetingId,
  type,
  label,
  icon: Icon,
}: {
  meetingId: number;
  type: 'summary' | 'full';
  label: string;
  icon: typeof Download;
}) {
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get(`/meetings/${meetingId}/download`, {
        params: { type, format: 'md' },
        responseType: 'blob',
      });
      const blob = new Blob([res.data], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.headers['content-disposition']?.match(/filename="?(.+?)"?$/)?.[1] ?? `meeting-${type}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Ошибка скачивания');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleDownload}
      disabled={loading}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-800 dark:hover:text-gray-200 transition-colors cursor-pointer disabled:opacity-50"
    >
      <Icon size={14} />
      {loading ? '...' : label}
    </button>
  );
}

export function MeetingReadonly({ meeting }: Props) {
  const { t } = useLangStore();
  const [people, setPeople] = useState<Person[]>([]);
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    apiGet<Person[]>(`/meetings/${meeting.id}/people`).then(setPeople).catch(() => {});
    apiGet<Agreement[]>(`/meetings/${meeting.id}/agreements`).then(setAgreements).catch(() => {});
    setShowTranscript(false);
  }, [meeting.id]);

  const { summary, transcript } = splitSummaryAndTranscript(meeting.summary_raw);

  return (
    <div className="px-8 py-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-4">{meeting.title}</h1>

      {/* Meta */}
      <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400 mb-6">
        <span className="flex items-center gap-1.5">
          <Calendar size={14} />
          {meeting.date}
        </span>
        {people.length > 0 && (
          <span className="flex items-center gap-1.5">
            <Users size={14} />
            {people.map((p) => p.name).join(', ')}
          </span>
        )}
      </div>

      {/* Download buttons */}
      <div className="flex items-center gap-2 mb-6">
        {summary && (
          <DownloadButton meetingId={meeting.id} type="summary" label={t('Скачать резюме', 'Download summary')} icon={FileText} />
        )}
        {transcript && (
          <DownloadButton meetingId={meeting.id} type="full" label={t('Скачать транскрипт', 'Download transcript')} icon={ScrollText} />
        )}
      </div>

      {/* Summary section */}
      {summary && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-3">
            {t('Резюме', 'Summary')}
          </h2>
          <div className="prose prose-sm dark:prose-invert max-w-none text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
            {summary}
          </div>
        </div>
      )}

      {/* Agreements */}
      {agreements.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-3">
            {t('Договорённости', 'Agreements')}
          </h2>
          <ul className="space-y-2">
            {agreements.map((a) => (
              <li key={a.id} className="flex items-start gap-2 text-sm">
                <span className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                  a.status === 'done' ? 'bg-green-600/20 border-green-600 text-green-400' : 'border-gray-300 dark:border-gray-600'
                }`}>
                  {a.status === 'done' && '✓'}
                </span>
                <span className={a.status === 'done' ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-700 dark:text-gray-300'}>
                  {a.description}
                  {a.due_date && <span className="text-gray-400 dark:text-gray-500 ml-2">· {a.due_date}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Transcript section */}
      {transcript && (
        <div>
          <button
            onClick={() => setShowTranscript(!showTranscript)}
            className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-3 cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
          >
            <ScrollText size={14} />
            {t('Полная транскрипция', 'Full transcript')}
            <span className="text-xs font-normal normal-case text-gray-400">
              ({showTranscript ? t('скрыть', 'hide') : t('показать', 'show')})
            </span>
          </button>
          {showTranscript && (
            <div className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap leading-relaxed border-l-2 border-gray-200 dark:border-gray-700 pl-4">
              {transcript}
            </div>
          )}
        </div>
      )}

      {/* Fallback: no summary, no transcript — show raw */}
      {!summary && !transcript && meeting.summary_raw && (
        <div className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
          {meeting.summary_raw}
        </div>
      )}
    </div>
  );
}
