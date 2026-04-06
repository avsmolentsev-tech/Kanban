import { useEffect, useState } from 'react';
import { FileIngestion } from '../components/upload/FileIngestion';
import { VoiceDictation } from '../components/upload/VoiceDictation';
import { ClaudeChat } from '../components/chat/ClaudeChat';
import { ingestApi } from '../api/ingest.api';
import { projectsApi } from '../api/projects.api';
import type { InboxItem, IngestResult, Project } from '@pis/shared';

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
    <div className="flex h-full overflow-hidden">
      {/* Left: main content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 min-w-0">
        <h1 className="text-xl font-bold text-gray-800">Inbox</h1>

        {/* Project selector (shared) */}
        {projects.length > 0 && (
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-600 whitespace-nowrap">Active project:</label>
            <select
              className="flex-1 max-w-xs border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-indigo-300"
              value={selectedProjectId ?? ''}
              onChange={(e) => setSelectedProjectId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Upload section */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Upload / Paste</h2>
          <FileIngestion
            onComplete={handleComplete}
            projects={projects}
            selectedProjectId={selectedProjectId}
            onProjectChange={setSelectedProjectId}
          />
        </div>

        {/* Voice Dictation section */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Voice Dictation</h2>
          <VoiceDictation onTranscript={handleVoiceTranscript} />
        </div>

        {/* Recent inbox items */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Recent Inbox Items</h2>
          {loadingRecent ? (
            <div className="text-sm text-gray-400">Loading...</div>
          ) : recentItems.length === 0 ? (
            <div className="text-sm text-gray-400">No items yet.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {recentItems.map((item) => (
                <li key={item.id} className="py-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm text-gray-700 truncate">{item.original_filename}</div>
                    {item.extracted_text && (
                      <div className="text-xs text-gray-400 truncate max-w-xs">{item.extracted_text.slice(0, 80)}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {item.target_type && (
                      <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full capitalize">{item.target_type}</span>
                    )}
                    {item.processed ? (
                      <span className="text-xs text-green-500">Done</span>
                    ) : item.error ? (
                      <span className="text-xs text-red-400">Error</span>
                    ) : (
                      <span className="text-xs text-yellow-400">Pending</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Right: Claude Chat sidebar */}
      <div className="w-80 flex-shrink-0 flex flex-col border-l bg-white">
        <ClaudeChat />
      </div>
    </div>
  );
}
