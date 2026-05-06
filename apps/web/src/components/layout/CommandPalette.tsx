import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, Calendar, FileText, Users, Target, Columns3, Clock, BarChart3 } from 'lucide-react';
import { useLangStore } from '../../store/lang.store';
import { apiPost } from '../../api/client';
import { useTasksStore, useProjectsStore } from '../../store';

interface CommandItem {
  id: string;
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  action: () => void;
  keywords: string;
}

export function CommandPalette() {
  const { t } = useLangStore();
  const navigate = useNavigate();
  const { fetchTasks } = useTasksStore();
  const { projects } = useProjectsStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Listen for Ctrl+K / Cmd+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
        setQuery('');
        setSelected(0);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // Quick create task from query text
  const createTask = async () => {
    if (!query.trim()) return;
    setCreating(true);
    try {
      // Parse simple format: "task title @project !p1-5 due:date"
      let title = query.trim();
      let projectId: number | undefined;
      let priority = 3;

      // Extract @project
      const projMatch = title.match(/@(\S+)/);
      if (projMatch) {
        const hint = projMatch[1]!.toLowerCase();
        const proj = projects.find(p => p.name.toLowerCase().includes(hint));
        if (proj) projectId = proj.id;
        title = title.replace(/@\S+/, '').trim();
      }

      // Extract !p1-5
      const prioMatch = title.match(/!p([1-5])/i);
      if (prioMatch) {
        priority = Number(prioMatch[1]);
        title = title.replace(/!p[1-5]/i, '').trim();
      }

      await apiPost('/tasks', { title, status: 'todo', priority, project_id: projectId });
      fetchTasks();
      setOpen(false);
      setQuery('');
    } catch {} finally { setCreating(false); }
  };

  const commands: CommandItem[] = [
    { id: 'nav-kanban', icon: <Columns3 size={16} />, label: 'Kanban', sublabel: t('Доска задач', 'Task board'), action: () => { navigate('/'); setOpen(false); }, keywords: 'kanban доска board' },
    { id: 'nav-timeline', icon: <Clock size={16} />, label: 'Timeline', sublabel: t('Задачи по срокам', 'Tasks by deadline'), action: () => { navigate('/timeline'); setOpen(false); }, keywords: 'timeline таймлайн сроки' },
    { id: 'nav-gantt', icon: <BarChart3 size={16} />, label: 'Gantt', sublabel: t('Диаграмма', 'Chart'), action: () => { navigate('/gantt'); setOpen(false); }, keywords: 'gantt гант диаграмма' },
    { id: 'nav-meetings', icon: <Users size={16} />, label: t('Встречи', 'Meetings'), action: () => { navigate('/meetings'); setOpen(false); }, keywords: 'meetings встречи' },
    { id: 'nav-docs', icon: <FileText size={16} />, label: t('Документы', 'Documents'), action: () => { navigate('/documents'); setOpen(false); }, keywords: 'documents документы docs' },
    { id: 'nav-calendar', icon: <Calendar size={16} />, label: t('Календарь', 'Calendar'), action: () => { navigate('/calendar'); setOpen(false); }, keywords: 'calendar календарь' },
    { id: 'nav-goals', icon: <Target size={16} />, label: t('Цели', 'Goals'), action: () => { navigate('/goals'); setOpen(false); }, keywords: 'goals цели objectives' },
    { id: 'nav-brief', icon: <FileText size={16} />, label: t('Брифинг', 'Brief'), action: () => { navigate('/brief'); setOpen(false); }, keywords: 'brief брифинг утро morning' },
    { id: 'nav-projects', icon: <Columns3 size={16} />, label: t('Проекты', 'Projects'), action: () => { navigate('/projects'); setOpen(false); }, keywords: 'projects проекты' },
  ];

  const q = query.toLowerCase();
  const filtered = q
    ? commands.filter(c => c.label.toLowerCase().includes(q) || c.keywords.includes(q) || (c.sublabel || '').toLowerCase().includes(q))
    : commands;

  const showCreateHint = q.length > 2 && filtered.length === 0;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(i => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (showCreateHint || filtered.length === 0) { createTask(); }
      else if (filtered[selected]) { filtered[selected]!.action(); }
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[15vh] bg-black/40" onClick={() => setOpen(false)}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden border border-gray-200 dark:border-gray-700" onClick={(e) => e.stopPropagation()}>
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <Search size={18} className="text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none"
            placeholder={t('Введите команду или название задачи...', 'Type command or task name...')}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
            onKeyDown={handleKeyDown}
          />
          <kbd className="px-1.5 py-0.5 text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600 font-mono">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[300px] overflow-y-auto py-2">
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              onClick={cmd.action}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors cursor-pointer ${
                i === selected ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
              }`}
            >
              <span className="text-gray-400">{cmd.icon}</span>
              <span className="text-sm font-medium">{cmd.label}</span>
              {cmd.sublabel && <span className="text-xs text-gray-400 ml-auto">{cmd.sublabel}</span>}
            </button>
          ))}

          {/* Quick create hint */}
          {showCreateHint && (
            <button
              onClick={createTask}
              disabled={creating}
              className="w-full flex items-center gap-3 px-4 py-3 text-left bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 cursor-pointer"
            >
              <Plus size={16} />
              <div>
                <div className="text-sm font-medium">{creating ? '...' : t('Создать задачу', 'Create task')}: "{query}"</div>
                <div className="text-[10px] text-indigo-400 mt-0.5">{t('Подсказка: @проект !p1-5 для приоритета', 'Hint: @project !p1-5 for priority')}</div>
              </div>
              <kbd className="ml-auto px-1.5 py-0.5 text-[10px] bg-indigo-100 dark:bg-indigo-800 rounded font-mono">Enter</kbd>
            </button>
          )}

          {filtered.length === 0 && !showCreateHint && (
            <div className="px-4 py-6 text-center text-sm text-gray-400">{t('Ничего не найдено', 'Nothing found')}</div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-700 flex items-center gap-4 text-[10px] text-gray-400">
          <span><kbd className="font-mono bg-gray-100 dark:bg-gray-700 px-1 rounded">↑↓</kbd> {t('навигация', 'navigate')}</span>
          <span><kbd className="font-mono bg-gray-100 dark:bg-gray-700 px-1 rounded">Enter</kbd> {t('выбрать', 'select')}</span>
          <span><kbd className="font-mono bg-gray-100 dark:bg-gray-700 px-1 rounded">Esc</kbd> {t('закрыть', 'close')}</span>
        </div>
      </div>
    </div>
  );
}
