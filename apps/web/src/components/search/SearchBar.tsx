import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchApi, type SearchHit } from '../../api/search.api';

const TYPE_LABELS: Record<string, string> = {
  task: 'Tasks',
  meeting: 'Meetings',
  idea: 'Ideas',
  document: 'Documents',
  person: 'People',
  vault: 'Vault',
};

const TYPE_ROUTES: Record<string, string> = {
  task: '/',
  meeting: '/meetings',
  idea: '/ideas',
  document: '/documents',
  person: '/people',
  vault: '/inbox',
};

export function SearchBar() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const navigate = useNavigate();

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const hits = await searchApi.search(query);
        setResults(hits);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [query]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); setQuery(''); setResults([]); }
      // Ctrl+K or Cmd+K to open search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setOpen(true); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleClick = (hit: SearchHit) => {
    const route = TYPE_ROUTES[hit.type] ?? '/';
    navigate(route);
    setOpen(false);
    setQuery('');
    setResults([]);
  };

  // Group results by type
  const grouped = new Map<string, SearchHit[]>();
  for (const hit of results) {
    if (!grouped.has(hit.type)) grouped.set(hit.type, []);
    grouped.get(hit.type)!.push(hit);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-2 text-gray-400 hover:text-gray-600 transition-colors" title="Search (Ctrl+K)">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <span className="text-xs hidden lg:inline">Search</span>
        <kbd className="hidden lg:inline text-[10px] bg-gray-100 border border-gray-200 rounded px-1 py-0.5 text-gray-400">Ctrl+K</kbd>
      </button>
    );
  }

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/10 z-40" onClick={() => { setOpen(false); setQuery(''); setResults([]); }} />

      {/* Search panel */}
      <div className="fixed top-16 left-1/2 -translate-x-1/2 w-full max-w-lg z-50">
        <div className="bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden">
          {/* Input */}
          <div className="flex items-center gap-2 px-4 py-3 border-b">
            <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={inputRef}
              className="flex-1 text-sm outline-none"
              placeholder="Search tasks, meetings, ideas, people..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {loading && <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />}
            <kbd className="text-[10px] bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5 text-gray-400">Esc</kbd>
          </div>

          {/* Results */}
          {results.length > 0 && (
            <div className="max-h-80 overflow-y-auto py-2">
              {[...grouped.entries()].map(([type, hits]) => (
                <div key={type}>
                  <div className="px-4 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                    {TYPE_LABELS[type] ?? type}
                  </div>
                  {hits.slice(0, 5).map((hit) => (
                    <button key={`${hit.type}-${hit.ref_id}`} onClick={() => handleClick(hit)}
                      className="w-full text-left px-4 py-2 hover:bg-indigo-50 transition-colors flex flex-col">
                      <span className="text-sm font-medium text-gray-800">{hit.title}</span>
                      {hit.snippet && (
                        <span className="text-xs text-gray-500 line-clamp-1" dangerouslySetInnerHTML={{ __html: hit.snippet }} />
                      )}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}

          {query.trim() && !loading && results.length === 0 && (
            <div className="px-4 py-6 text-sm text-gray-400 text-center">No results</div>
          )}
        </div>
      </div>
    </>
  );
}
