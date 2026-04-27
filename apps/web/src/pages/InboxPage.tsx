import { useEffect, useState } from 'react';
import { FileIngestion } from '../components/upload/FileIngestion';
import { VoiceDictation } from '../components/upload/VoiceDictation';
import { ClaudeChat } from '../components/chat/ClaudeChat';
import { ingestApi } from '../api/ingest.api';
import { projectsApi } from '../api/projects.api';
import type { InboxItem, IngestResult, Project } from '@pis/shared';

function InboxItemRow({ item, onDelete }: { item: InboxItem; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 cursor-pointer" onClick={() => setExpanded(!expanded)}>
          <div className="text-sm text-gray-700 flex items-center gap-2">
            <span className="truncate">{item.original_filename}</span>
            {item.extracted_text && (
              <span className="text-xs text-gray-400">{expanded ? '▼' : '▶'}</span>
            )}
          </div>
          {!expanded && item.extracted_text && (
            <div className="text-xs text-gray-400 truncate max-w-md">{item.extracted_text.slice(0, 100)}</div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {item.target_type && (
            <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full capitalize">{item.target_type}</span>
          )}
          {item.processed ? (
            <span className="text-xs text-green-500">OK</span>
          ) : item.error ? (
            <span className="text-xs text-red-400">Err</span>
          ) : (
            <span className="text-xs text-yellow-400">...</span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); if (confirm('Удалить?')) onDelete(); }}
            className="text-xs text-red-400 hover:text-red-600 px-1"
          >
            ✕
          </button>
        </div>
      </div>
      {expanded && item.extracted_text && (
        <div className="mt-2 p-3 bg-gray-50 rounded-lg text-xs text-gray-600 whitespace-pre-wrap max-h-60 overflow-auto">
          {item.extracted_text}
        </div>
      )}
    </li>
  );
}

export function InboxPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [recentItems, setRecentItems] = useState<InboxItem[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);

  useEffect(() => {
    projectsApi.list().then(setProjects).catch(() => {});
    fetchRecent();
  }, []);

  const fetchRecent = () => {
    setLoadingRecent(true);
    ingestApi.listRecent().then(setRecentItems).catch(() => {}).finally(() => setLoadingRecent(false));
  };

  const handleComplete = (_r: IngestResult) => {
    fetchRecent();
  };

  const handleVoiceTranscript = async (text: string) => {
    try {
      const r = await ingestApi.pasteText(text, selectedProjectId ?? undefined);
      handleComplete(r);
    } catch {
      // ignore
    }
  };

  return (
    <div className="relative overflow-hidden flex h-full">
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full border border-indigo-400/20 dark:border-white/[0.06]" style={{ animation: 'circleLeft 14s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute -top-20 -right-20 w-[350px] h-[350px] rounded-full border border-purple-400/25 dark:border-white/[0.06]" style={{ animation: 'circleLeftSlow 12s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] h-[500px] rounded-full bg-indigo-400/[0.08] dark:bg-white/[0.03] blur-[80px]" style={{ animation: 'circleRight 16s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      {/* Left: main content */}
      <div className="relative z-10 flex-1 overflow-y-auto p-6 space-y-6 min-w-0">
        <h1 className="text-xl font-bold text-gray-800">Входящие</h1>

        {/* Project selector (shared) */}
        {projects.length > 0 && (
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-600 whitespace-nowrap">Активный проект:</label>
            <select
              className="flex-1 max-w-xs border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-indigo-300"
              value={selectedProjectId ?? ''}
              onChange={(e) => setSelectedProjectId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Без проекта</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Upload section */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Загрузка / Вставка</h2>
          <FileIngestion
            onComplete={handleComplete}
            projects={projects}
            selectedProjectId={selectedProjectId}
            onProjectChange={setSelectedProjectId}
          />
        </div>

        {/* Voice Dictation section */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Голосовой ввод</h2>
          <VoiceDictation onTranscript={handleVoiceTranscript} />
        </div>

        {/* Recent inbox items */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Недавние элементы</h2>
          {loadingRecent ? (
            <div className="text-sm text-gray-400">Загрузка...</div>
          ) : recentItems.length === 0 ? (
            <div className="text-sm text-gray-400">Пока ничего нет.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {recentItems.map((item) => (
                <InboxItemRow key={item.id} item={item} onDelete={async () => {
                  await ingestApi.delete(item.id);
                  fetchRecent();
                }} />
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Right: Claude Chat sidebar */}
      <div className="w-80 flex-shrink-0 flex flex-col border-l border-gray-200 bg-white">
        <ClaudeChat />
      </div>
    </div>
  );
}
