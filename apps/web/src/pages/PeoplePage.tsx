import { useEffect, useState } from 'react';
import { DndContext, rectIntersection, type DragEndEvent, MouseSensor, TouchSensor, useSensor, useSensors, useDroppable, useDraggable, DragOverlay } from '@dnd-kit/core';
import { peopleApi } from '../api/people.api';
import { projectsApi } from '../api/projects.api';
import { Avatar } from '../components/ui/Avatar';
import { PersonDetailPanel } from '../components/people/PersonDetailPanel';
import { ProjectFilter } from '../components/filters/ProjectFilter';
import { useFiltersStore } from '../store';
import type { Person, Project } from '@pis/shared';
import { useLangStore } from '../store/lang.store';
import { Users } from 'lucide-react';

function DraggablePersonCard({ person, project, onClick }: { person: Person; project: Project | null; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: person.id });
  const style = { transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, opacity: isDragging ? 0.4 : 1 };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} onClick={onClick}
      className="bg-white rounded-lg border border-gray-200 p-3 w-56 cursor-pointer hover:border-indigo-300 hover:shadow-sm transition-all">
      <div className="flex items-center gap-2 mb-1.5">
        <Avatar name={person.name} size="sm" />
        <div className="font-medium text-sm text-gray-800 truncate">{person.name}</div>
      </div>
      <div className="text-xs text-gray-500 truncate">{person.role}{person.company ? ` @ ${person.company}` : ''}</div>
      {(person.email || person.telegram) && <div className="text-xs text-gray-400 mt-0.5 truncate">{person.email || person.telegram}</div>}
      {person.projects && person.projects.length > 1 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {person.projects.filter(pr => pr.id !== project?.id).map(pr => (
            <span key={pr.id} className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: pr.color + '22', color: pr.color }}>
              {pr.name}
            </span>
          ))}
        </div>
      )}
      {person.notes && <div className="text-xs text-gray-500 mt-1.5 line-clamp-2 leading-relaxed">{person.notes}</div>}
    </div>
  );
}

function PeopleDropZone({ projectId, project, groupPeople, onClickPerson }: { projectId: number | null; project: Project | null; groupPeople: Person[]; onClickPerson: (p: Person) => void }) {
  const { t } = useLangStore();
  const { setNodeRef: setRegularRef, isOver: isOverRegular } = useDroppable({ id: `people-zone-${projectId ?? 'none'}` });
  const { setNodeRef: setAsapRef, isOver: isOverAsap } = useDroppable({ id: `people-asap-${projectId ?? 'none'}` });

  const asapPeople = groupPeople.filter(p => (p as unknown as Record<string, unknown>)['meet_asap'] === 1);
  const regularPeople = groupPeople.filter(p => (p as unknown as Record<string, unknown>)['meet_asap'] !== 1);

  return (
    <div className="flex">
      <div className="sticky left-0 top-12 z-20 w-40 min-w-[160px] flex-shrink-0 pr-3 pt-3 border-r border-gray-100 dark:border-gray-700/50 self-start" style={{ background: 'inherit' }}>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: project?.color ?? '#9ca3af' }} />
          <span className="text-sm font-semibold text-gray-700 truncate">{project?.name ?? t('Без проекта', 'No project')}</span>
        </div>
        <div className="text-xs text-gray-400 mt-1 ml-5">{groupPeople.length} {t('чел.', 'ppl.')}</div>
      </div>

      {/* ASAP column */}
      <div
        ref={setAsapRef}
        className={`flex gap-2 flex-wrap w-72 min-w-[288px] min-h-[60px] rounded-xl p-2 mr-3 border-2 border-dashed transition-colors ${
          isOverAsap
            ? 'border-sky-400 bg-sky-100/60 dark:bg-sky-900/20'
            : 'border-sky-200 dark:border-sky-800/40 bg-sky-50/40 dark:bg-sky-900/10'
        }`}
      >
        {asapPeople.length === 0 && (
          <div className="text-xs text-sky-500 self-center px-2">⭐ ASAP</div>
        )}
        {asapPeople.map(p => (
          <DraggablePersonCard key={`asap-${projectId}-${p.id}`} person={p} project={project} onClick={() => onClickPerson(p)} />
        ))}
      </div>

      {/* Regular people */}
      <div
        ref={setRegularRef}
        className={`flex gap-3 flex-wrap flex-1 min-h-[60px] rounded-xl p-2 transition-colors ${isOverRegular ? 'bg-indigo-50 border-2 border-dashed border-indigo-300' : ''}`}
      >
        {regularPeople.map((p) => (
          <DraggablePersonCard key={`${projectId}-${p.id}`} person={p} project={project} onClick={() => onClickPerson(p)} />
        ))}
        {regularPeople.length === 0 && <div className="text-gray-300 text-xs self-center">{t('Перетащи сюда', 'Drop here')}</div>}
      </div>
    </div>
  );
}

export function PeoplePage() {
  const { t } = useLangStore();
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

  // Build group map — normalise unknown project IDs to null so that
  // all people without a valid project end up in a single "Без проекта" group.
  const groupMap = new Map<number | null, Person[]>();
  for (const person of people) {
    const ids = person.project_ids && person.project_ids.length > 0
      ? person.project_ids
      : [null];
    for (const rawPid of ids) {
      // Treat unknown / deleted project IDs the same as "no project"
      const pid = rawPid !== null && projectMap.has(rawPid) ? rawPid : null;
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

  const mouseSensor = useSensor(MouseSensor, { activationConstraint: { distance: 3 } });
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } });
  const sensors = useSensors(mouseSensor, touchSensor);
  const [draggingPerson, setDraggingPerson] = useState<Person | null>(null);

  const handleDragEnd = async (e: DragEndEvent) => {
    setDraggingPerson(null);
    const { active, over } = e;
    if (!over) return;
    const personId = Number(active.id);
    const overId = String(over.id);
    const person = people.find((p) => p.id === personId);
    if (!person) return;

    // Drop on per-project ASAP column
    if (overId.startsWith('people-asap-')) {
      const targetProjectPart = overId.replace('people-asap-', '');
      const targetPid = targetProjectPart === 'none' ? null : Number(targetProjectPart);
      const currentIds = person.project_ids ?? [];
      const updates: Record<string, unknown> = { meet_asap: true };
      if (targetPid && !currentIds.includes(targetPid)) {
        updates['project_ids'] = [...currentIds, targetPid];
      }
      await peopleApi.update(personId, updates as Partial<{ meet_asap: boolean; project_ids: number[] }>);
      load();
      return;
    }

    if (!overId.startsWith('people-zone-')) return;
    const targetProjectId = overId.replace('people-zone-', '');
    const targetPid = targetProjectId === 'none' ? null : Number(targetProjectId);
    const currentIds = person.project_ids ?? [];
    let newIds: number[];
    if (targetPid === null) {
      newIds = [];
    } else if (currentIds.includes(targetPid)) {
      // Same project drop → just remove ASAP
      await peopleApi.update(personId, { meet_asap: false } as unknown as Partial<{ meet_asap: boolean }>);
      load();
      return;
    } else {
      newIds = [...currentIds, targetPid];
    }
    await peopleApi.update(personId, { project_ids: newIds, meet_asap: false } as unknown as Partial<{ project_ids: number[]; meet_asap: boolean }>);
    load();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="page-header flex items-center justify-between px-6 py-4 border-b bg-white dark:bg-gray-900 dark:border-gray-700">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center shadow-lg shadow-teal-500/25">
            <Users size={20} className="text-white" />
          </div>
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('Люди', 'People')}</h1>
        </div>
        <div className="flex items-center gap-3">
          <ProjectFilter projects={projects} />
          {!adding && (
            <button onClick={() => setAdding(true)} className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 flex-shrink-0">
            {t('+ Контакт', '+ Contact')}
          </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-auto p-6">

      {adding && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-indigo-200 dark:border-indigo-700 shadow-lg p-4 mb-6 max-w-md space-y-3">
          <input autoFocus className="w-full text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 focus:outline-none focus:border-indigo-300 dark:focus:border-indigo-500 placeholder-gray-400 dark:placeholder-gray-500"
            placeholder={t('ФИО *', 'Full name *')} value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setAdding(false); }} />
          <div className="grid grid-cols-2 gap-3">
            <input className="text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 focus:outline-none focus:border-indigo-300 dark:focus:border-indigo-500 placeholder-gray-400 dark:placeholder-gray-500"
              placeholder={t('Компания', 'Company')} value={company} onChange={(e) => setCompany(e.target.value)} />
            <input className="text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 focus:outline-none focus:border-indigo-300 dark:focus:border-indigo-500 placeholder-gray-400 dark:placeholder-gray-500"
              placeholder={t('Роль', 'Role')} value={role} onChange={(e) => setRole(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <input className="text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 focus:outline-none focus:border-indigo-300 dark:focus:border-indigo-500 placeholder-gray-400 dark:placeholder-gray-500"
              placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className="text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 focus:outline-none focus:border-indigo-300 dark:focus:border-indigo-500 placeholder-gray-400 dark:placeholder-gray-500"
              placeholder="Telegram" value={telegram} onChange={(e) => setTelegram(e.target.value)} />
            <input className="text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 focus:outline-none focus:border-indigo-300 dark:focus:border-indigo-500 placeholder-gray-400 dark:placeholder-gray-500"
              placeholder={t('Телефон', 'Phone')} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <textarea className="w-full text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 focus:outline-none focus:border-indigo-300 dark:focus:border-indigo-500 resize-none placeholder-gray-400 dark:placeholder-gray-500"
            placeholder={t('Заметки / описание', 'Notes / description')} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          {activeProjects.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">{t('Проекты', 'Projects')}</div>
              <div className="flex flex-wrap gap-2">
                {activeProjects.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleAddProject(p.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors ${selectedProjectIds.includes(p.id) ? 'border-transparent text-white' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-600'}`}
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
            <button onClick={() => setAdding(false)} className="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 px-3 py-1.5">{t('Отмена', 'Cancel')}</button>
            <button onClick={submit} disabled={!name.trim() || submitting}
              className="text-sm bg-indigo-600 text-white px-4 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              {submitting ? '...' : t('Добавить контакт', 'Add contact')}
            </button>
          </div>
        </div>
      )}

      {people.length === 0 && <div className="text-gray-400 text-sm">{t('Нет контактов', 'No contacts')}</div>}

      <DndContext sensors={sensors} collisionDetection={rectIntersection} onDragStart={(e) => setDraggingPerson(people.find((p) => p.id === Number(e.active.id)) ?? null)} onDragEnd={handleDragEnd}>
        {/* Sticky header with columns */}
        <div className="sticky top-0 z-30 flex bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 py-2">
          <div className="sticky left-0 z-40 w-40 min-w-[160px] flex-shrink-0 pl-4" style={{ background: 'inherit' }} />
          <div className="w-72 min-w-[288px] mr-3 text-sm font-semibold text-sky-600 text-center">⭐ ASAP</div>
          <div className="flex-1 text-sm font-semibold text-gray-500 text-center">{t('Все контакты', 'All contacts')}</div>
        </div>

        <div className="space-y-4 mt-4">
          {filteredGrouped.map(({ project, people: groupPeople }) => (
            <PeopleDropZone key={project?.id ?? 'unassigned'} projectId={project?.id ?? null} project={project} groupPeople={groupPeople} onClickPerson={setSelected} />
          ))}
        </div>
        <DragOverlay>
          {draggingPerson && (
            <div className="bg-white rounded-lg border-2 border-indigo-400 shadow-xl p-3 w-56 opacity-90">
              <div className="flex items-center gap-2">
                <Avatar name={draggingPerson.name} size="sm" />
                <div className="font-medium text-sm text-gray-800">{draggingPerson.name}</div>
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>
      </div>
      <PersonDetailPanel person={selected} projects={projects} onClose={() => setSelected(null)} onUpdated={load} onDeleted={() => { setSelected(null); load(); }} />
    </div>
  );
}
