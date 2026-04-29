import { Calendar, Users } from 'lucide-react';
import type { SidebarMeeting } from '../../store/documents.store';
import { useLangStore } from '../../store/lang.store';
import { useEffect, useState } from 'react';
import { apiGet } from '../../api/client';

interface Person {
  id: number;
  name: string;
}

interface Agreement {
  id: number;
  description: string;
  status: string;
  due_date: string | null;
  person_id: number | null;
}

interface Props {
  meeting: SidebarMeeting;
}

export function MeetingReadonly({ meeting }: Props) {
  const { t } = useLangStore();
  const [people, setPeople] = useState<Person[]>([]);
  const [agreements, setAgreements] = useState<Agreement[]>([]);

  useEffect(() => {
    apiGet<Person[]>(`/meetings/${meeting.id}/people`).then(setPeople).catch(() => {});
    apiGet<Agreement[]>(`/meetings/${meeting.id}/agreements`).then(setAgreements).catch(() => {});
  }, [meeting.id]);

  return (
    <div className="px-8 py-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-100 mb-4">{meeting.title}</h1>

      <div className="flex items-center gap-4 text-sm text-gray-400 mb-6">
        <span className="flex items-center gap-1.5">
          <Calendar size={14} />
          {meeting.date}
        </span>
        {people.length > 0 && (
          <span className="flex items-center gap-1.5">
            <Users size={14} />
            {people.map((p) => p.name).join(', ')}
          </span>
        )}
      </div>

      {meeting.summary_structured && (
        <div className="prose prose-invert prose-sm max-w-none mb-6">
          <div dangerouslySetInnerHTML={{ __html: meeting.summary_structured }} />
        </div>
      )}

      {!meeting.summary_structured && meeting.summary_raw && (
        <div className="text-sm text-gray-300 whitespace-pre-wrap mb-6">{meeting.summary_raw}</div>
      )}

      {agreements.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-300 mb-3">{t('Договорённости', 'Agreements')}</h3>
          <ul className="space-y-2">
            {agreements.map((a) => (
              <li key={a.id} className="flex items-start gap-2 text-sm">
                <span className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                  a.status === 'done' ? 'bg-green-600/20 border-green-600 text-green-400' : 'border-gray-600'
                }`}>
                  {a.status === 'done' && '✓'}
                </span>
                <span className={a.status === 'done' ? 'text-gray-500 line-through' : 'text-gray-300'}>
                  {a.description}
                  {a.due_date && <span className="text-gray-500 ml-2">· {a.due_date}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
