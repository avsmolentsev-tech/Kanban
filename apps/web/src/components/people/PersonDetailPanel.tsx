import { useState, useEffect } from 'react';
import { SlidePanel } from '../ui/SlidePanel';
import { Avatar } from '../ui/Avatar';
import { peopleApi } from '../../api/people.api';
import type { Person, Project } from '@pis/shared';

interface Props {
  person: Person | null;
  projects: Project[];
  onClose: () => void;
  onUpdated: () => void;
}

export function PersonDetailPanel({ person, projects, onClose, onUpdated }: Props) {
  const [form, setForm] = useState<Partial<Person>>({});
  const [projectIds, setProjectIds] = useState<number[]>([]);

  useEffect(() => {
    if (person) {
      setForm({ ...person });
      setProjectIds(person.project_ids ?? (person.project_id != null ? [person.project_id] : []));
    }
  }, [person]);

  const save = async (field: string, value: string | number | null) => {
    if (!person) return;
    await peopleApi.update(person.id, { [field]: value });
    onUpdated();
  };

  const handleChange = (field: keyof Person, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  const handleBlur = (field: string) => {
    if (!person) return;
    const newVal = (form as unknown as Record<string, unknown>)[field];
    const oldVal = (person as unknown as Record<string, unknown>)[field];
    if (newVal !== oldVal) save(field, newVal as string);
  };

  const toggleProject = async (id: number) => {
    if (!person) return;
    const next = projectIds.includes(id) ? projectIds.filter(x => x !== id) : [...projectIds, id];
    setProjectIds(next);
    await peopleApi.update(person.id, { project_ids: next });
    onUpdated();
  };

  const activeProjects = projects.filter(p => !p.archived);

  return (
    <SlidePanel open={!!person} onClose={onClose} title={person?.name ?? ''}>
      {person && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 mb-4">
            <Avatar name={form.name ?? person.name} size="md" />
            <input className="flex-1 text-lg font-semibold border-b border-transparent hover:border-gray-300 focus:border-indigo-400 focus:outline-none px-1 py-0.5"
              value={form.name ?? ''} onChange={(e) => handleChange('name', e.target.value)} onBlur={() => handleBlur('name')} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Company" value={form.company ?? ''} onChange={(v) => handleChange('company', v)} onBlur={() => handleBlur('company')} />
            <Field label="Role" value={form.role ?? ''} onChange={(v) => handleChange('role', v)} onBlur={() => handleBlur('role')} />
          </div>

          <div className="grid grid-cols-1 gap-3">
            <Field label="Email" value={form.email ?? ''} onChange={(v) => handleChange('email', v)} onBlur={() => handleBlur('email')} />
            <Field label="Telegram" value={form.telegram ?? ''} onChange={(v) => handleChange('telegram', v)} onBlur={() => handleBlur('telegram')} />
            <Field label="Phone" value={form.phone ?? ''} onChange={(v) => handleChange('phone', v)} onBlur={() => handleBlur('phone')} />
          </div>

          {activeProjects.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-1.5">Projects</div>
              <div className="flex flex-wrap gap-2">
                {activeProjects.map(p => {
                  const active = projectIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleProject(p.id)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors ${active ? 'border-transparent text-white' : 'border-gray-200 text-gray-600 bg-white hover:border-gray-300'}`}
                      style={active ? { backgroundColor: p.color, borderColor: p.color } : {}}
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: active ? 'rgba(255,255,255,0.7)' : p.color }} />
                      {p.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <div className="text-xs text-gray-500 mb-1">Notes</div>
            <textarea className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300 resize-none"
              rows={4} value={form.notes ?? ''} onChange={(e) => handleChange('notes', e.target.value)} onBlur={() => handleBlur('notes')} />
          </div>

          <div className="text-xs text-gray-400 pt-2">Created: {person.created_at}</div>
        </div>
      )}
    </SlidePanel>
  );
}

function Field({ label, value, onChange, onBlur }: { label: string; value: string; onChange: (v: string) => void; onBlur: () => void }) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <input className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300"
        value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
    </div>
  );
}
