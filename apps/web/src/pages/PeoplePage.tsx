import { useEffect, useState } from 'react';
import { peopleApi } from '../api/people.api';
import { projectsApi } from '../api/projects.api';
import { Avatar } from '../components/ui/Avatar';
import { PersonDetailPanel } from '../components/people/PersonDetailPanel';
import { ProjectFilter } from '../components/filters/ProjectFilter';
import { useFiltersStore } from '../store';
import type { Person, Project } from '@pis/shared';

export function PeoplePage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const { selectedProjectIds: filterProjectIds } = useFiltersStore();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [email, setEmail] = useState('');
  const [telegram, setTelegram] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedProjectIds, setSelectedProjectIds] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<Person | null>(null);

  const load = () => {
    peopleApi.list().then(setPeople);
    projectsApi.list().then(setProjects);
  };
  useEffect(load, []);

  const toggleAddProject = (id: number) => {
    setSelectedProjectIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const submit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await peopleApi.create({ name: name.trim(), company, role, email, telegram, phone, notes, project_ids: selectedProjectIds });
      setName(''); setCompany(''); setRole(''); setEmail(''); setTelegram(''); setPhone(''); setNotes(''); setSelectedProjectIds([]);
      setAdding(false);
      load();
    } finally { setSubmitting(false); }
  };

  // Group people by project: a person with multiple projects appears in each group
  const projectMap = new Map<number, Project>(projects.map(p => [p.id, p]));
  const grouped: Array<{ project: Project | null; people: Person[] }> = [];

  // Build group map
  const groupMap = new Map<number | null, Person[]>();
  for (const person of people) {
    const ids = person.project_ids && person.project_ids.length > 0
      ? person.project_ids
      : [null];
    for (const pid of ids) {
      if (!groupMap.has(pid)) groupMap.set(pid, []);
      groupMap.get(pid)!.push(person);
    }
  }

  for (const [pid, groupPeople] of groupMap.entries()) {
    grouped.push({
      project: pid !== null ? (projectMap.get(pid) ?? null) : null,
      people: groupPeople,
    });
  }

  // Sort: projects first (by order_index), unassigned last
  grouped.sort((a, b) => {
    if (a.project === null) return 1;
    if (b.project === null) return -1;
    return (a.project.order_index ?? 0) - (b.project.order_index ?? 0);
  });

  // Apply project filter
  const filteredGrouped = filterProjectIds === null
    ? grouped
    : grouped.filter((g) => g.project !== null && filterProjectIds.has(g.project.id));

  const activeProjects = projects.filter(p => !p.archived);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-800">People</h1>
        <div className="flex items-center gap-3">
          <ProjectFilter projects={projects} />
          {!adding && (
            <button onClick={() => setAdding(true)} className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 flex-shrink-0">
            + New person
          </button>
          )}
        </div>
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
          {activeProjects.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-1.5">Projects</div>
              <div className="flex flex-wrap gap-2">
                {activeProjects.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleAddProject(p.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors ${selectedProjectIds.includes(p.id) ? 'border-transparent text-white' : 'border-gray-200 text-gray-600 bg-white hover:border-gray-300'}`}
                    style={selectedProjectIds.includes(p.id) ? { backgroundColor: p.color, borderColor: p.color } : {}}
                  >
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: selectedProjectIds.includes(p.id) ? 'rgba(255,255,255,0.7)' : p.color }} />
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}
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

      <div className="space-y-4">
        {filteredGrouped.map(({ project, people: groupPeople }) => (
          <div key={project?.id ?? 'unassigned'} className="flex">
            {/* Project label on the left */}
            <div className="w-40 min-w-[160px] flex-shrink-0 pr-3 pt-3">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: project?.color ?? '#9ca3af' }} />
                <span className="text-sm font-semibold text-gray-700 truncate">{project?.name ?? 'No project'}</span>
              </div>
              <div className="text-xs text-gray-400 mt-1 ml-5">{groupPeople.length} person{groupPeople.length !== 1 ? 's' : ''}</div>
            </div>

            {/* People cards */}
            <div className="flex gap-3 flex-wrap flex-1">
              {groupPeople.map((p) => (
                <div key={p.id} className="bg-white rounded-lg border border-gray-200 p-3 w-56 cursor-pointer hover:border-indigo-300 hover:shadow-sm transition-all" onClick={() => setSelected(p)}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Avatar name={p.name} size="sm" />
                    <div className="font-medium text-sm text-gray-800 truncate">{p.name}</div>
                  </div>
                  <div className="text-xs text-gray-500 truncate">{p.role}{p.company ? ` @ ${p.company}` : ''}</div>
                  {(p.email || p.telegram) && <div className="text-xs text-gray-400 mt-0.5 truncate">{p.email || p.telegram}</div>}
                  {p.projects && p.projects.length > 1 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {p.projects.filter(pr => pr.id !== project?.id).map(pr => (
                        <span key={pr.id} className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: pr.color + '22', color: pr.color }}>
                          {pr.name}
                        </span>
                      ))}
                    </div>
                  )}
                  {p.notes && <div className="text-xs text-gray-500 mt-1.5 line-clamp-2 leading-relaxed">{p.notes}</div>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <PersonDetailPanel person={selected} projects={projects} onClose={() => setSelected(null)} onUpdated={load} />
    </div>
  );
}
