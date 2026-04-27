import { useEffect, useState, useRef } from 'react';
import { meetingsApi } from '../api/meetings.api';
import { projectsApi } from '../api/projects.api';
import { apiClient } from '../api/client';
import { MeetingDetailPanel } from '../components/meetings/MeetingDetailPanel';
import { ProjectFilter } from '../components/filters/ProjectFilter';
import { useFiltersStore } from '../store';
import type { Meeting, Project } from '@pis/shared';
import { useLangStore } from '../store/lang.store';
import { Users } from 'lucide-react';

type TimePeriod = 'today' | 'week' | 'month' | 'year';

// PERIOD_LABELS is now built inside MeetingsPage using t() for bilingual support

function classifyMeeting(date: string | null): TimePeriod | 'none' {
  if (!date) return 'none';
  const d = new Date(date);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);

  // Today (past or future within today)
  if (d >= today && d < tomorrow) return 'today';

  // For past meetings: classify by how long ago
  if (d < today) {
    const daysAgo = Math.floor((today.getTime() - d.getTime()) / (24 * 60 * 60 * 1000));
    if (daysAgo <= 7) return 'week';
    if (daysAgo <= 30) return 'month';
    if (d.getFullYear() === now.getFullYear()) return 'year';
    return 'none'; // older than this year → no date column
  }

  // Future meetings
  const endOfWeek = new Date(today); endOfWeek.setDate(today.getDate() + (7 - today.getDay()));
  if (d >= tomorrow && d < endOfWeek) return 'week';
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  if (d >= endOfWeek && d <= endOfMonth) return 'month';
  if (d.getFullYear() === now.getFullYear() && d > endOfMonth) return 'year';
  return 'year';
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  queued: { label: '⏳ В очереди', color: 'bg-gray-100 dark:bg-gray-700/60 text-gray-700 dark:text-gray-200' },
  compressing: { label: '🗜️ Сжимаем', color: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-200' },
  transcribing: { label: '🎤 Транскрибируем', color: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-200' },
  summarizing: { label: '✍️ Резюме', color: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-200' },
  failed: { label: '⚠️ Ошибка', color: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-200' },
};

function MeetingCard({ meeting, project, onClick }: { meeting: Meeting; project?: Project; onClick: () => void }) {
  const status = (meeting as unknown as Record<string, unknown>)['processing_status'] as string | undefined;
  const statusInfo = status && status !== 'done' ? STATUS_LABELS[status] : null;
  return (
    <div
      onClick={onClick}
      className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-500 hover:shadow-sm transition-all"
    >
      <div className="flex items-center gap-2 mb-1">
        {project && <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: project.color }} />}
        <div className="font-medium text-sm text-gray-800 dark:text-gray-100 truncate">{meeting.title}</div>
      </div>
      <div className="text-xs text-gray-400 dark:text-gray-500">{meeting.date}</div>
      {statusInfo && (
        <div className={`mt-1.5 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${statusInfo.color}`}>
          {statusInfo.label}
        </div>
      )}
      {meeting.summary_raw && !statusInfo && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 line-clamp-2 leading-relaxed">{meeting.summary_raw.slice(0, 100)}</p>
      )}
    </div>
  );
}

function MeetingColumn({ label, meetings, projectMap, onClickMeeting }: {
  label: string; meetings: Meeting[]; projectMap: Map<number, Project>; onClickMeeting: (m: Meeting) => void;
}) {
  return (
    <div className="flex flex-col w-56 min-w-[224px] bg-gray-100 rounded-xl p-3">
      <div className="text-xs font-semibold text-gray-500 mb-2 text-center">{label}</div>
      <div className="flex flex-col gap-2 flex-1 min-h-[60px]">
        {meetings.map((m) => (
          <MeetingCard key={m.id} meeting={m} project={m.project_id ? projectMap.get(m.project_id) : undefined} onClick={() => onClickMeeting(m)} />
        ))}
        {meetings.length === 0 && <div className="text-gray-300 text-xs text-center py-4">—</div>}
      </div>
    </div>
  );
}

export function MeetingsPage() {
  const { t } = useLangStore();

  const PERIOD_LABELS: Record<TimePeriod | 'none', string> = {
    today: t('Сегодня', 'Today'),
    week: t('На неделе', 'This week'),
    month: t('В этом месяце', 'This month'),
    year: t('В этом году', 'This year'),
    none: t('Без даты', 'No date'),
  };

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const { selectedProjectIds } = useFiltersStore();
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newProjectIds, setNewProjectIds] = useState<number[]>([]);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [newSyncVault, setNewSyncVault] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitStage, setSubmitStage] = useState<'' | 'creating' | 'transcribing' | 'summarizing'>('');
  const [transcribing, setTranscribing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const newFileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    meetingsApi.list().then(setMeetings);
    projectsApi.list().then(setProjects);
  };
  useEffect(load, []);

  // Auto-poll meetings list while any meeting is processing
  useEffect(() => {
    const anyProcessing = meetings.some((m) => {
      const s = (m as unknown as Record<string, unknown>)['processing_status'];
      return s && s !== 'done' && s !== 'failed';
    });
    if (!anyProcessing) return;
    const timer = setInterval(() => {
      meetingsApi.list().then(setMeetings);
    }, 3000);
    return () => clearInterval(timer);
  }, [meetings]);

  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const activeProjects = projects.filter((p) => !p.archived);

  const hasDraft = () => !!(newTitle.trim() || newFile || newProjectIds.length > 0 || newDate);

  const tryCancel = () => {
    if (submitting) return;
    if (hasDraft() && !confirm(t('Закрыть без сохранения? Введённые данные будут потеряны.', 'Close without saving? Entered data will be lost.'))) return;
    setNewTitle(''); setNewDate(''); setNewProjectIds([]); setNewFile(null); setNewSyncVault(true);
    setAdding(false);
  };

  const submit = async () => {
    if (!newTitle.trim()) return;
    setSubmitting(true);
    try {
      setSubmitStage('creating');
      const created = await meetingsApi.create({
        title: newTitle.trim(),
        date: newDate || new Date().toISOString().slice(0, 10),
        project_id: newProjectIds[0],
        project_ids: newProjectIds.length > 0 ? newProjectIds : undefined,
        summary_raw: '',
        sync_vault: newSyncVault,
      }) as unknown as { id: number };

      if (newFile && created?.id) {
        setSubmitStage('transcribing');
        const form = new FormData();
        form.append('audio', newFile);
        // Background job: server returns 202 immediately
        await apiClient.post(`/meetings/${created.id}/transcribe`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 120000, // upload timeout, not transcription wait
        });
      }

      setNewTitle(''); setNewDate(''); setNewProjectIds([]); setNewFile(null); setNewSyncVault(true); setAdding(false);
      load();
    } catch (err) {
      alert(t('Ошибка: ', 'Error: ') + (err instanceof Error ? err.message : 'unknown'));
    } finally { setSubmitting(false); setSubmitStage(''); }
  };

  const handleTranscribe = async (meetingId: number, file: File) => {
    setTranscribing(true);
    try {
      const form = new FormData();
      form.append('audio', file);
      await apiClient.post(`/meetings/${meetingId}/transcribe`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      load();
      // Refresh selected meeting
      const updated = await meetingsApi.get(meetingId);
      setSelected(updated as unknown as Meeting);
    } catch (err) {
      alert(`${t('Ошибка транскрипции', 'Transcription error')}: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally { setTranscribing(false); }
  };

  // Filter meetings (use project_ids many-to-many, fallback to project_id)
  const meetingProjectIds = (m: Meeting): number[] => {
    const ids = (m as unknown as Record<string, unknown>)['project_ids'] as number[] | undefined;
    if (ids && ids.length > 0) return ids;
    return m.project_id != null ? [m.project_id] : [];
  };

  const filtered = selectedProjectIds === null
    ? meetings
    : meetings.filter((m) => {
        const ids = meetingProjectIds(m);
        return ids.some((id) => selectedProjectIds.has(id));
      });

  // Group: a meeting with multiple projects appears in EACH project's row
  const projectGroups = new Map<number | null, Meeting[]>();
  for (const m of filtered) {
    const ids = meetingProjectIds(m);
    if (ids.length === 0) {
      if (!projectGroups.has(null)) projectGroups.set(null, []);
      projectGroups.get(null)!.push(m);
    } else {
      for (const pid of ids) {
        if (!projectGroups.has(pid)) projectGroups.set(pid, []);
        projectGroups.get(pid)!.push(m);
      }
    }
  }

  const rows: Array<{ project: Project | null; meetings: Meeting[] }> = [];
  for (const p of activeProjects) {
    const ms = projectGroups.get(p.id);
    if (ms) rows.push({ project: p, meetings: ms });
  }
  const unassigned = projectGroups.get(null);
  if (unassigned) rows.push({ project: null, meetings: unassigned });

  const periods: Array<TimePeriod | 'none'> = ['today', 'week', 'month', 'year', 'none'];

  return (
    <div className="relative overflow-hidden flex flex-col h-full">
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full border border-indigo-400/20 dark:border-white/[0.06]" style={{ animation: 'circleLeft 40s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute -top-20 -right-20 w-[350px] h-[350px] rounded-full border border-purple-400/25 dark:border-white/[0.06]" style={{ animation: 'circleLeftSlow 36s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] h-[500px] rounded-full bg-indigo-400/[0.08] dark:bg-white/[0.03] blur-[80px]" style={{ animation: 'circleRight 42s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="relative z-10 page-header flex items-center justify-between px-4 pt-4 pb-2 border-b bg-white dark:bg-gray-900 dark:border-gray-700">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/25">
            <Users size={20} className="text-white" />
          </div>
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('Встречи', 'Meetings')}</h1>
        </div>
        <div className="flex items-center gap-3">
          <ProjectFilter projects={projects} />
          {!adding && (
            <button onClick={() => setAdding(true)} className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">
              {t('+ Встреча', '+ Meeting')}
            </button>
          )}
        </div>
      </div>

      {adding && (
        <div className="bg-white dark:bg-gray-900 border-b dark:border-gray-700 p-4">
          <div className="max-w-xl space-y-3">
            <input autoFocus className="w-full text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 focus:outline-none focus:border-indigo-300 dark:focus:border-indigo-500"
              placeholder={t('Название встречи *', 'Meeting title *')} value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') tryCancel(); if (e.key === 'Enter' && !submitting) submit(); }} />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('Дата', 'Date')}</div>
                <input type="date" className="w-full text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 focus:outline-none focus:border-indigo-300 dark:focus:border-indigo-500"
                  value={newDate} onChange={(e) => setNewDate(e.target.value)} />
              </div>
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('Проекты', 'Projects')}</div>
                <div className="flex flex-wrap gap-1.5">
                  {activeProjects.map((p) => {
                    const active = newProjectIds.includes(p.id);
                    return (
                      <button key={p.id} type="button" onClick={() => setNewProjectIds(active ? newProjectIds.filter((x) => x !== p.id) : [...newProjectIds, p.id])}
                        className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs border transition-colors ${active ? 'border-transparent text-white' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800'}`}
                        style={active ? { backgroundColor: p.color, borderColor: p.color } : {}}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: active ? 'rgba(255,255,255,0.8)' : p.color }} />
                        {p.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('Аудио/видео файл (опционально)', 'Audio/video file (optional)')}</div>
              <div
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) setNewFile(f); }}
                onClick={() => newFileRef.current?.click()}
                className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg px-3 py-4 text-center cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors">
                <input ref={newFileRef} type="file" className="hidden"
                  accept="audio/*,video/*,.ogg,.oga,.mp3,.mp4,.m4a,.wav,.webm,.flac"
                  onChange={(e) => setNewFile(e.target.files?.[0] ?? null)} />
                {newFile ? (
                  <div className="text-sm">
                    <div className="text-gray-700 dark:text-gray-200 font-medium">🎧 {newFile.name}</div>
                    <div className="text-xs text-gray-400 dark:text-gray-500">{(newFile.size / 1024 / 1024).toFixed(1)} МБ — {t('нажмите ещё раз чтобы заменить', 'click again to replace')}</div>
                  </div>
                ) : (
                  <div className="text-sm text-gray-400 dark:text-gray-500">
                    {t('Перетащите файл или кликните. Поддержка: ogg, mp3, mp4, m4a, wav, webm, flac', 'Drop a file or click. Formats: ogg, mp3, mp4, m4a, wav, webm, flac')}
                  </div>
                )}
              </div>
              {newFile && (
                <div className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                  {t('После создания файл будет транскрибирован и резюмирован автоматически (1-10 мин).', 'File will be transcribed and summarized automatically after creation (1-10 min).')}
                </div>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer select-none">
              <input type="checkbox" checked={newSyncVault} onChange={(e) => setNewSyncVault(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500" />
              <span>{t('Синхронизировать с Obsidian', 'Sync with Obsidian')}</span>
              <span className="text-xs text-gray-400 dark:text-gray-500">{t('(по умолчанию вкл)', '(on by default)')}</span>
            </label>

            <div className="flex items-center justify-between">
              <div className="text-xs text-gray-500 dark:text-gray-400 min-h-[16px]">
                {submitStage === 'creating' && t('Создание встречи...', 'Creating meeting...')}
                {submitStage === 'transcribing' && t('🎤 Транскрибируем (может занять несколько минут)...', '🎤 Transcribing (may take a few minutes)...')}
                {submitStage === 'summarizing' && t('✍️ Делаем резюме...', '✍️ Summarizing...')}
              </div>
              <div className="flex gap-2">
                <button onClick={tryCancel} disabled={submitting}
                  className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
                  {t('✕ Закрыть без сохранения', '✕ Close without saving')}
                </button>
                <button onClick={submit} disabled={!newTitle.trim() || submitting}
                  className="text-sm bg-indigo-600 text-white px-4 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                  {submitting ? '...' : t('✓ Создать', '✓ Create')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="relative z-10 flex-1 overflow-auto">
        {/* Sticky column headers */}
        <div className="sticky top-0 z-30 flex bg-gray-50/90 dark:bg-gray-900/90 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 py-2">
          <div className="sticky left-0 z-40 w-40 min-w-[160px] flex-shrink-0 pl-4" style={{ background: 'inherit' }} />
          {periods.map((p) => (
            <div key={p} className="w-56 min-w-[224px] mx-1.5 text-sm font-semibold text-gray-500 text-center">
              {PERIOD_LABELS[p]}
            </div>
          ))}
        </div>

        <div className="p-4 pt-2">
        {/* Project rows */}
        {rows.map(({ project, meetings: rowMeetings }) => {
          const grouped: Record<TimePeriod | 'none', Meeting[]> = { today: [], week: [], month: [], year: [], none: [] };
          for (const m of rowMeetings) grouped[classifyMeeting(m.date)].push(m);

          return (
            <div key={project?.id ?? 'none'} className="flex mb-4">
              <div className="sticky left-0 top-12 z-20 w-40 min-w-[160px] flex-shrink-0 pr-3 pt-3 self-start" style={{ background: 'inherit' }}>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: project?.color ?? '#9ca3af' }} />
                  <span className="text-sm font-semibold text-gray-700 truncate">{project?.name ?? t('Без проекта', 'No project')}</span>
                </div>
                <div className="text-xs text-gray-400 mt-1 ml-5">{rowMeetings.length} {t('встреч', 'meetings')}</div>
              </div>
              <div className="flex gap-3">
                {periods.map((period) => (
                  <MeetingColumn key={`${project?.id ?? 'none'}-${period}`} label="" meetings={grouped[period]}
                    projectMap={projectMap} onClickMeeting={setSelected} />
                ))}
              </div>
            </div>
          );
        })}

        {rows.length === 0 && !adding && (
          <div className="text-gray-400 text-sm text-center py-8">{t('Нет встреч', 'No meetings')}</div>
        )}
        </div>
      </div>

      {/* Hidden file input for audio upload */}
      <input ref={fileRef} type="file" accept="audio/*,.ogg,.mp3,.wav,.m4a,.webm" className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && selected) handleTranscribe(selected.id, file);
          e.target.value = '';
        }} />

      {/* Detail panel with transcribe button */}
      {selected && (
        <MeetingDetailPanel
          meeting={selected}
          projects={projects}
          onClose={() => setSelected(null)}
          onUpdated={() => { load(); }}
          onDeleted={() => { setSelected(null); load(); }}
          onTranscribe={() => fileRef.current?.click()}
          transcribing={transcribing}
        />
      )}
    </div>
  );
}
