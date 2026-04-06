import { useEffect, useState } from 'react';
import { peopleApi } from '../api/people.api';
import { Avatar } from '../components/ui/Avatar';
import type { Person } from '@pis/shared';
export function PeoplePage() {
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => { peopleApi.list().then(setPeople); }, []);
  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-gray-800 mb-6">People</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {people.map((p) => (
          <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
            <Avatar name={p.name} size="md" />
            <div><div className="font-medium text-gray-800">{p.name}</div><div className="text-sm text-gray-500">{p.role}{p.company ? ` @ ${p.company}` : ''}</div></div>
          </div>
        ))}
        {people.length === 0 && <div className="text-gray-400 text-sm">No people yet</div>}
      </div>
    </div>
  );
}
