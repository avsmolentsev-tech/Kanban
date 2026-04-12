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

function MeetingCard({ meeting, project, onClick }: { meeting: Meeting; project?: Project; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="bg-white rounded-xl border border-gray-200 p-3 cursor-pointer hover:border-indigo-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-center gap-2 mb-1">
        {project && <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: project.color }} />}
        <div className="font-medium text-sm text-gray-800 truncate">{meeting.title}</div>
      </div>
      <div className="text-xs text-gray-400">{meeting.date}</div>
      {meeting.summary_raw && (
        <p className="text-xs text-gray-500 mt-1.5 line-clamp-2 leading-relaxed">{meeting.summary_raw.slice(0, 100)}</p>
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
  const [newProjectId, setNewProjectId] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    meetingsApi.list().then(setMeetings);
    projectsApi.list().then(setProjects);
  };
  useEffect(load, []);

  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const activeProjects = projects.filter((p) => !p.archived);

  const submit = async () => {
    if (!newTitle.trim()) return;
    setSubmitting(true);
    try {
      await meetingsApi.create({
        title: newTitle.trim(),
        date: newDate || new Date().toISOString().slice(0, 10),
        project_id: newProjectId !== '' ? Number(newProjectId) : undefined,
        summary_raw: '',
      });
      setNewTitle(''); setNewDate(''); setNewProjectId(''); setAdding(false);
      load();
    } finally { setSubmitting(false); }
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
    <div className="flex flex-col h-full">
      <div className="page-header flex items-center justify-between px-4 pt-4 pb-2 border-b dark:border-gray-700">
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
        <div className="bg-white border-b p-4">
          <div className="max-w-md space-y-3">
            <input autoFocus className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:border-indigo-300"
              placeholder={t('Название встречи *', 'Meeting title *')} value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setAdding(false); if (e.key === 'Enter') submit(); }} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-gray-500 mb-1">{t('Дата', 'Date')}</div>
                <input type="date" className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:border-indigo-300"
                  value={newDate} onChange={(e) => setNewDate(e.target.value)} />
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">{t('Проект', 'Project')}</div>
                <select className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:border-indigo-300 bg-white"
                  value={newProjectId} onChange={(e) => setNewProjectId(e.target.value !== '' ? Number(e.target.value) : '')}>
                  <option value="">{t('Без проекта', 'No project')}</option>
                  {activeProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setAdding(false)} className="text-sm text-gray-400 hover:text-gray-600 px-3 py-1.5">{t('Отмена', 'Cancel')}</button>
              <button onClick={submit} disabled={!newTitle.trim() || submitting}
                className="text-sm bg-indigo-600 text-white px-4 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {submitting ? '...' : t('Создать', 'Create')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto relative">
        {/* Sticky column headers */}
        <div className="sticky top-0 z-30 flex bg-gray-50 border-b border-gray-200 py-2">
          <div className="sticky left-0 z-40 w-40 min-w-[160px] flex-shrink-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md pl-4" />
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
              <div className="sticky left-0 top-12 z-20 w-40 min-w-[160px] flex-shrink-0 pr-3 pt-3 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-r border-gray-100 dark:border-gray-700/50 self-start">
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
