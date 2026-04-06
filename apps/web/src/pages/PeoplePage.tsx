import { useEffect, useState } from 'react';
import { peopleApi } from '../api/people.api';
import { projectsApi } from '../api/projects.api';
import { Avatar } from '../components/ui/Avatar';
import type { Person, Project } from '@pis/shared';

export function PeoplePage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [email, setEmail] = useState('');
  const [telegram, setTelegram] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [projectId, setProjectId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    peopleApi.list().then(setPeople);
    projectsApi.list().then(setProjects);
  };
  useEffect(load, []);

  const submit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await peopleApi.create({ name: name.trim(), company, role, email, telegram, phone, notes, project_id: projectId });
      setName(''); setCompany(''); setRole(''); setEmail(''); setTelegram(''); setPhone(''); setNotes(''); setProjectId(null);
      setAdding(false);
      load();
    } finally { setSubmitting(false); }
  };

  // Group people by project
  const projectMap = new Map<number, Project>(projects.map(p => [p.id, p]));
  const grouped: Array<{ project: Project | null; people: Person[] }> = [];
  const seen = new Set<number | null>();

  for (const person of people) {
    const pid = person.project_id ?? null;
    if (!seen.has(pid)) {
      seen.add(pid);
      grouped.push({
        project: pid !== null ? (projectMap.get(pid) ?? null) : null,
        people: [],
      });
    }
    grouped.find(g => g.project?.id === pid || (pid === null && g.project === null))!.people.push(person);
  }

  // Sort: projects first (by order_index), unassigned last
  grouped.sort((a, b) => {
    if (a.project === null) return 1;
    if (b.project === null) return -1;
    return (a.project.order_index ?? 0) - (b.project.order_index ?? 0);
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-800">People</h1>
        {!adding && (
          <button onClick={() => setAdding(true)} className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">
            + New person
          </button>
        )}
      </div>

      {adding && (
        <div className="bg-white rounded-xl border border-indigo-200 shadow-lg p-4 mb-6 max-w-md space-y-3">
          <input autoFocus className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:border-indigo-300"
            placeholder="Full name *" value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setAdding(false); }} />
          <div className="grid grid-cols-2 gap-3">
            <input className="text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:border-indigo-300"
              placeholder="Company" value={company} onChange={(e) => setCompany(e.target.value)} />
            <input className="text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:border-indigo-300"
              placeholder="Role" value={role} onChange={(e) => setRole(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <input className="text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:border-indigo-300"
              placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className="text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:border-indigo-300"
              placeholder="Telegram" value={telegram} onChange={(e) => setTelegram(e.target.value)} />
            <input className="text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:border-indigo-300"
              placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <textarea className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:border-indigo-300 resize-none"
            placeholder="Notes / description" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <select
            className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:border-indigo-300 bg-white"
            value={projectId ?? ''}
            onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">No project</option>
            {projects.filter(p => !p.archived).map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className="text-sm text-gray-400 hover:text-gray-600 px-3 py-1.5">Cancel</button>
            <button onClick={submit} disabled={!name.trim() || submitting}
              className="text-sm bg-indigo-600 text-white px-4 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              {submitting ? '...' : 'Add person'}
            </button>
          </div>
        </div>
      )}

      {people.length === 0 && <div className="text-gray-400 text-sm">No people yet</div>}

      <div className="space-y-6">
        {grouped.map(({ project, people: groupPeople }) => (
          <div key={project?.id ?? 'unassigned'}>
            <div className="flex items-center gap-2 mb-3">
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: project?.color ?? '#9ca3af' }}
              />
              <span className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
                {project?.name ?? 'No project'}
              </span>
              <span className="text-xs text-gray-400">({groupPeople.length})</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {groupPeople.map((p) => (
                <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-start gap-3">
                  <Avatar name={p.name} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-800 truncate">{p.name}</div>
                    <div className="text-sm text-gray-500 truncate">{p.role}{p.company ? ` @ ${p.company}` : ''}</div>
                    {(p.email || p.telegram) && <div className="text-xs text-gray-400 mt-0.5 truncate">{p.email || p.telegram}</div>}
                    {p.notes && <div className="text-xs text-gray-500 mt-1.5 line-clamp-2 leading-relaxed">{p.notes}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
