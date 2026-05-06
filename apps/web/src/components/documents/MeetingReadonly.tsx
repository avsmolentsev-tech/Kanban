import { Calendar, Users, Download, FileText, ScrollText, Pencil, ListChecks } from 'lucide-react';
import type { SidebarMeeting } from '../../store/documents.store';
import { useDocumentsStore } from '../../store/documents.store';
import { useLangStore } from '../../store/lang.store';
import { useEffect, useState, useCallback } from 'react';
import { tasksApi } from '../../api/tasks.api';
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

interface ProSummaries {
  notes?: string;
  qa?: string;
  actions?: string;
  transcript?: string;
}

interface Props {
  meeting: SidebarMeeting;
}

function splitSummaryAndTranscript(raw: string): { summary: string; transcript: string } {
  const separator = '\n\n---\n\n';
  const sepIdx = raw.indexOf(separator);
  if (sepIdx === -1) return { summary: raw, transcript: '' };
  const before = raw.slice(0, sepIdx).trim();
  const after = raw.slice(sepIdx + separator.length).trim();
  if (before.startsWith('## ')) return { summary: before, transcript: after };
  return { summary: before, transcript: after };
}

function DownloadButton({ meetingId, type, label, icon: Icon }: {
  meetingId: number; type: 'summary' | 'full' | 'notes' | 'qa' | 'actions'; label: string; icon: typeof Download;
}) {
  const handleDownload = () => {
    const token = localStorage.getItem('auth_token') || '';
    window.open(`/v1/meetings/${meetingId}/download?type=${type}&format=pdf&token=${encodeURIComponent(token)}`, '_blank');
  };
  return (
    <button onClick={handleDownload}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-800 dark:hover:text-gray-200 transition-colors cursor-pointer">
      <Icon size={14} />
      {label}
    </button>
  );
}

/** Render markdown-ish text with basic formatting */
function MarkdownText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none text-gray-700 dark:text-gray-300 leading-relaxed">
      {lines.map((line, i) => {
        if (line.startsWith('# ')) return <h1 key={i} className="text-xl font-bold mt-4 mb-2 text-gray-800 dark:text-gray-100">{line.slice(2)}</h1>;
        if (line.startsWith('## ')) return <h2 key={i} className="text-lg font-semibold mt-4 mb-2 text-gray-800 dark:text-gray-100">{line.slice(3)}</h2>;
        if (line.startsWith('### ')) return <h3 key={i} className="text-base font-semibold mt-3 mb-1 text-gray-800 dark:text-gray-100">{line.slice(4)}</h3>;
        if (line.startsWith('- [ ] ')) return <div key={i} className="flex items-start gap-2 ml-2 my-0.5"><span className="w-4 h-4 mt-0.5 rounded border border-gray-300 dark:border-gray-600 flex-shrink-0" /><span>{line.slice(6)}</span></div>;
        if (line.startsWith('- [x] ')) return <div key={i} className="flex items-start gap-2 ml-2 my-0.5"><span className="w-4 h-4 mt-0.5 rounded border border-green-500 bg-green-500/20 flex-shrink-0 text-center text-[10px] text-green-400">✓</span><span className="line-through text-gray-400">{line.slice(6)}</span></div>;
        if (line.startsWith('- ')) return <div key={i} className="ml-2 my-0.5">• {line.slice(2)}</div>;
        if (line.startsWith('> ')) return <blockquote key={i} className="border-l-2 border-indigo-400 pl-3 italic text-gray-500 dark:text-gray-400 my-1">{line.slice(2)}</blockquote>;
        if (line.trim() === '') return <div key={i} className="h-2" />;
        return <p key={i} className="my-0.5">{line}</p>;
      })}
    </div>
  );
}

type SummaryTab = 'notes' | 'qa' | 'actions' | 'summary';

export function MeetingReadonly({ meeting }: Props) {
  const { t } = useLangStore();
  const [people, setPeople] = useState<Person[]>([]);
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [showTranscript, setShowTranscript] = useState(false);
  const [proSummaries, setProSummaries] = useState<ProSummaries | null>(null);
  const [activeTab, setActiveTab] = useState<SummaryTab>('notes');

  useEffect(() => {
    apiGet<Person[]>(`/meetings/${meeting.id}/people`).then(setPeople).catch(() => {});
    apiGet<Agreement[]>(`/meetings/${meeting.id}/agreements`).then(setAgreements).catch(() => {});
    setShowTranscript(false);
    // Load structured summaries
    apiGet<{ summary_structured: string }>(`/meetings/${meeting.id}`).then((data) => {
      try {
        const parsed = JSON.parse((data as any).summary_structured || '{}') as ProSummaries;
        if (parsed.notes || parsed.qa || parsed.actions) {
          setProSummaries(parsed);
          setActiveTab('notes');
        } else {
          setProSummaries(null);
        }
      } catch { setProSummaries(null); }
    }).catch(() => setProSummaries(null));
  }, [meeting.id]);

  const [showTaskDialog, setShowTaskDialog] = useState(false);
  const [extractedTasks, setExtractedTasks] = useState<string[]>([]);
  const [selectedTasks, setSelectedTasks] = useState<Set<number>>(new Set());
  const [creatingTasks, setCreatingTasks] = useState(false);

  // Extract tasks from notes (lines starting with "- [ ]")
  useEffect(() => {
    const notes = proSummaries?.notes || '';
    const taskLines = notes.split('\n')
      .filter(l => l.trim().startsWith('- [ ]'))
      .map(l => l.replace(/^-\s*\[\s*\]\s*/, '').trim())
      .filter(Boolean);
    setExtractedTasks(taskLines);
  }, [proSummaries?.notes]);

  const handleCreateTasks = useCallback(async () => {
    if (selectedTasks.size === 0) return;
    setCreatingTasks(true);
    try {
      for (const idx of selectedTasks) {
        const title = extractedTasks[idx];
        if (title) {
          await tasksApi.create({
            title,
            status: 'backlog',
            priority: 3,
            project_id: meeting.project_id ?? undefined,
            description: `Из встречи: ${meeting.title} (${meeting.date})`,
          });
        }
      }
      setShowTaskDialog(false);
      setSelectedTasks(new Set());
    } catch {
    } finally {
      setCreatingTasks(false);
    }
  }, [selectedTasks, extractedTasks, meeting]);

  const { summary, transcript } = splitSummaryAndTranscript(meeting.summary_raw);
  const hasProSummaries = proSummaries && (proSummaries.notes || proSummaries.qa);

  const tabs: Array<{ key: SummaryTab; label: string }> = hasProSummaries
    ? [
        { key: 'notes', label: t('Заметки', 'Notes') },
        { key: 'qa', label: 'Q&A' },
        { key: 'summary', label: t('Резюме', 'Summary') },
      ]
    : [];

  return (
    <div className="px-8 py-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-4">{meeting.title}</h1>

      {/* Meta */}
      <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400 mb-6">
        <span className="flex items-center gap-1.5"><Calendar size={14} />{meeting.date}</span>
        {people.length > 0 && (
          <span className="flex items-center gap-1.5"><Users size={14} />{people.map((p) => p.name).join(', ')}</span>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {hasProSummaries && (
          <>
            <DownloadButton meetingId={meeting.id} type="notes" label={t('Заметки', 'Notes')} icon={FileText} />
            <DownloadButton meetingId={meeting.id} type="qa" label="Q&A" icon={FileText} />
            {extractedTasks.length > 0 && (
              <button
                onClick={() => { setShowTaskDialog(true); setSelectedTasks(new Set()); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors cursor-pointer"
              >
                <ListChecks size={14} />
                {t('Задачи', 'Tasks')} ({extractedTasks.length})
              </button>
            )}
          </>
        )}
        {!hasProSummaries && summary && <DownloadButton meetingId={meeting.id} type="summary" label={t('Резюме', 'Summary')} icon={FileText} />}
        {(transcript || proSummaries?.transcript) && <DownloadButton meetingId={meeting.id} type="full" label={t('Транскрипт', 'Transcript')} icon={ScrollText} />}
        <button
          onClick={() => useDocumentsStore.getState().setEditingMeeting(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
        >
          <Pencil size={14} />
          {t('Редактировать', 'Edit')}
        </button>
      </div>

      {/* Pro summary tabs */}
      {tabs.length > 0 && (
        <div className="mb-6">
          <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-4">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                  activeTab === tab.key
                    ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'notes' && proSummaries?.notes && <MarkdownText text={proSummaries.notes} />}
          {activeTab === 'qa' && proSummaries?.qa && <MarkdownText text={proSummaries.qa} />}
          {activeTab === 'summary' && summary && (
            <div className="prose prose-sm dark:prose-invert max-w-none text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
              {summary}
            </div>
          )}
        </div>
      )}

      {/* Fallback: no pro summaries — show original summary */}
      {!hasProSummaries && summary && (
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
                }`}>{a.status === 'done' && '✓'}</span>
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
      {(transcript || proSummaries?.transcript) && (
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
              {transcript || proSummaries?.transcript}
            </div>
          )}
        </div>
      )}

      {!summary && !transcript && meeting.summary_raw && (
        <div className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
          {meeting.summary_raw}
        </div>
      )}

      {/* Task selection dialog */}
      {showTaskDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowTaskDialog(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{t('Задачи из встречи', 'Tasks from meeting')}</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('Редактируйте, удаляйте или добавляйте задачи', 'Edit, delete, or add tasks')}</p>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-3 space-y-1">
              {extractedTasks.map((task, idx) => (
                <div key={idx} className="flex items-start gap-2 py-1.5 group">
                  <input
                    type="checkbox"
                    checked={selectedTasks.has(idx)}
                    onChange={() => setSelectedTasks(prev => { const n = new Set(prev); if (n.has(idx)) n.delete(idx); else n.add(idx); return n; })}
                    className="w-4 h-4 mt-1 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500 cursor-pointer flex-shrink-0"
                  />
                  <textarea
                    className="flex-1 text-sm bg-transparent text-gray-700 dark:text-gray-300 border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-indigo-400 focus:outline-none px-1 py-0.5 resize-none overflow-hidden"
                    rows={Math.max(1, Math.ceil((task.length || 1) / 50))}
                    value={task}
                    onChange={(e) => setExtractedTasks(prev => prev.map((t, i) => i === idx ? e.target.value : t))}
                    onInput={(e) => { const el = e.target as HTMLTextAreaElement; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }}
                    ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }}
                  />
                  <button
                    onClick={() => {
                      setExtractedTasks(prev => prev.filter((_, i) => i !== idx));
                      setSelectedTasks(prev => { const n = new Set<number>(); for (const v of prev) { if (v < idx) n.add(v); else if (v > idx) n.add(v - 1); } return n; });
                    }}
                    className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all cursor-pointer flex-shrink-0 mt-1"
                    title={t('Удалить', 'Delete')}
                  >✕</button>
                </div>
              ))}
              {/* Add new task */}
              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={() => { setExtractedTasks(prev => [...prev, '']); setTimeout(() => { const inputs = document.querySelectorAll('.task-dialog-input'); (inputs[inputs.length - 1] as HTMLInputElement)?.focus(); }, 50); }}
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 cursor-pointer"
                >
                  + {t('Добавить задачу', 'Add task')}
                </button>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <button
                onClick={() => setSelectedTasks(prev => prev.size === extractedTasks.length ? new Set() : new Set(extractedTasks.map((_, i) => i)))}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 cursor-pointer"
              >
                {selectedTasks.size === extractedTasks.length ? t('Снять всё', 'Deselect all') : t('Выбрать всё', 'Select all')}
              </button>
              <div className="flex gap-2">
                <button onClick={() => setShowTaskDialog(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 cursor-pointer">
                  {t('Отмена', 'Cancel')}
                </button>
                <button
                  onClick={handleCreateTasks}
                  disabled={selectedTasks.size === 0 || creatingTasks}
                  className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
                >
                  {creatingTasks ? '...' : `${t('В бэклог', 'To backlog')} (${selectedTasks.size})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
