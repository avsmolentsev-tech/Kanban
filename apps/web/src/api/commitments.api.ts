import { apiGet } from './client';

export interface Commitment {
  id: number;
  title: string;
  status: string;
  due_date: string | null;
  commitment_type: string;
  commitment_owner: string | null;
  source_meeting_id: number | null;
  meeting_title: string | null;
  meeting_date: string | null;
  tracker_status: 'pending' | 'done' | 'overdue';
}

export const commitmentsApi = {
  list: () => apiGet<{ mine: Commitment[]; theirs: Commitment[] }>('/commitments'),
};
