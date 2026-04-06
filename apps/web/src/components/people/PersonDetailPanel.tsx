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

  useEffect(() => {
    if (person) setForm({ ...person });
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
    const newVal = (form as Record<string, unknown>)[field];
    const oldVal = (person as Record<string, unknown>)[field];
    if (newVal !== oldVal) save(field, newVal as string);
  };

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

          <div>
            <div className="text-xs text-gray-500 mb-1">Project</div>
            <select className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-300 bg-white"
              value={form.project_id ?? ''}
              onChange={(e) => {
                const val = e.target.value ? Number(e.target.value) : null;
                setForm((f) => ({ ...f, project_id: val }));
                save('project_id', val);
              }}>
              <option value="">No project</option>
              {projects.filter(p => !p.archived).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

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
