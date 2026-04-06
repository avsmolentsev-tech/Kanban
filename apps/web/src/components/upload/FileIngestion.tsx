import { useState, useRef } from 'react';
import { ingestApi } from '../../api/ingest.api';
import type { IngestResult } from '@pis/shared';

export function FileIngestion({ onComplete }: { onComplete?: (r: IngestResult) => void }) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    setLoading(true); setError(null); setResult(null);
    try { const r = await ingestApi.uploadFile(file); setResult(r); onComplete?.(r); }
    catch (e) { setError(e instanceof Error ? e.message : 'Upload failed'); }
    finally { setLoading(false); }
  };

  const processText = async () => {
    if (!text.trim()) return;
    setLoading(true); setError(null); setResult(null);
    try { const r = await ingestApi.pasteText(text); setResult(r); setText(''); onComplete?.(r); }
    catch (e) { setError(e instanceof Error ? e.message : 'Ingest failed'); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) processFile(f); }}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${dragging ? 'border-indigo-400 bg-indigo-50' : 'border-gray-300 hover:border-gray-400'}`}>
        <input ref={fileRef} type="file" className="hidden" accept=".txt,.md,.pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); }} />
        <div className="text-gray-500 text-sm">{loading ? 'Processing...' : 'Drop a file here or click to upload'}</div>
        <div className="text-gray-400 text-xs mt-1">Supported: .txt, .md, .pdf</div>
      </div>
      <div>
        <textarea className="w-full border border-gray-200 rounded-lg p-3 text-sm resize-none focus:outline-none focus:border-indigo-300" rows={4} placeholder="Or paste text here..." value={text} onChange={(e) => setText(e.target.value)} />
        <button onClick={processText} disabled={!text.trim() || loading} className="mt-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed">
          {loading ? 'Processing...' : 'Process text'}
        </button>
      </div>
      {result && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
          <div className="font-medium text-green-800 mb-1">Detected: <span className="capitalize">{result.detected_type}</span></div>
          <div className="text-green-700">{result.summary}</div>
          {result.created_records.map((r) => <div key={`${r.type}-${r.id}`} className="text-xs text-green-600 mt-1">Created {r.type}: {r.title}</div>)}
        </div>
      )}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}
    </div>
  );
}
