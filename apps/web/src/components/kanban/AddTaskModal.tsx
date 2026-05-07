import { useState } from 'react';
import { tasksApi } from '../../api/tasks.api';
import { useLangStore } from '../../store/lang.store';
import type { TaskStatus, Person, Project } from '@pis/shared';

interface Props {
  status: TaskStatus;
  projectId: number | null;
  people: Person[];
  projects?: Project[];
  dueDate?: string | null;
  onCreated: () => void;
  onCancel: () => void;
}

export function AddTaskModal({ status, projectId, people, projects, dueDate, onCreated, onCancel }: Props) {
  const { t } = useLangStore();
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState(3);
  const [selectedProject, setSelectedProject] = useState<number | null>(projectId);
  const [selectedPeople, setSelectedPeople] = useState<Set<number>>(new Set());
  const [peopleSearch, setPeopleSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!title.trim()) return;
    setLoading(true);
    try {
      await tasksApi.create({
        title: title.trim(),
        status,
        priority,
        project_id: selectedProject ?? undefined,
        person_ids: [...selectedPeople],
        due_date: dueDate ?? undefined,
      });
      onCreated();
    } finally {
      setLoading(false);
    }
  };

  const filteredPeople = peopleSearch
    ? people.filter(p => p.name.toLowerCase().includes(peopleSearch.toLowerCase()))
    : people;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40" onClick={onCancel}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden border border-gray-200 dark:border-gray-700" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">{t('Новая задача', 'New task')}</h3>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Title */}
          <input
            autoFocus
            className="w-full text-sm border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-lg px-3 py-2.5 focus:outline-none focus:border-indigo-400"
            placeholder={t('Название задачи...', 'Task name...')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) submit(); if (e.key === 'Escape') onCancel(); }}
            disabled={loading}
          />

          {/* Project */}
          {projects && projects.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-1.5">{t('Проект', 'Project')}</div>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => setSelectedProject(null)}
                  className={`px-2.5 py-1 text-xs rounded-full border transition-colors cursor-pointer ${!selectedProject ? 'bg-indigo-600 text-white border-indigo-600' : 'text-gray-500 border-gray-200 dark:border-gray-600 hover:border-indigo-300'}`}>
                  {t('Без проекта', 'No project')}
                </button>
                {projects.filter(p => !p.archived).map(p => (
                  <button key={p.id} onClick={() => setSelectedProject(p.id)}
                    className={`px-2.5 py-1 text-xs rounded-full border transition-colors cursor-pointer ${selectedProject === p.id ? 'text-white border-transparent' : 'text-gray-500 border-gray-200 dark:border-gray-600 hover:border-indigo-300'}`}
                    style={selectedProject === p.id ? { backgroundColor: p.color, borderColor: p.color } : undefined}>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Priority */}
          <div>
            <div className="text-xs text-gray-500 mb-1.5">{t('Приоритет', 'Priority')}</div>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map((p) => (
                <button key={p} onClick={() => setPriority(p)}
                  className={`w-8 h-8 rounded-lg text-xs font-bold transition-colors cursor-pointer ${priority === p ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* People */}
          {people.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-1.5">{t('Исполнители', 'Assignees')}</div>
              {people.length > 5 && (
                <input
                  className="w-full text-xs border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-lg px-2.5 py-1.5 mb-2 focus:outline-none focus:border-indigo-300"
                  placeholder={t('Поиск...', 'Search...')}
                  value={peopleSearch}
                  onChange={e => setPeopleSearch(e.target.value)}
                />
              )}
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                {filteredPeople.map(p => {
                  const active = selectedPeople.has(p.id);
                  return (
                    <button key={p.id} onClick={() => setSelectedPeople(prev => {
                      const next = new Set(prev);
                      if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
                      return next;
                    })}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors cursor-pointer ${
                        active ? 'bg-indigo-600 text-white border-indigo-600' : 'text-gray-500 border-gray-200 dark:border-gray-600 hover:border-indigo-300'
                      }`}>
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${active ? 'bg-indigo-400' : 'bg-gray-200 dark:bg-gray-600'}`}>
                        {p.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                      </span>
                      {p.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 cursor-pointer">
            {t('Отмена', 'Cancel')}
          </button>
          <button onClick={submit} disabled={!title.trim() || loading}
            className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 cursor-pointer font-medium">
            {loading ? '...' : t('Создать', 'Create')}
          </button>
        </div>
      </div>
    </div>
  );
}
