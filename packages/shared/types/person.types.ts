export interface Person {
  id: number;
  name: string;
  company: string;
  role: string;
  telegram: string;
  email: string;
  phone: string;
  notes: string;
  vault_path: string | null;
  project_id: number | null;
  project_ids?: number[];
  projects?: Array<{ id: number; name: string; color: string }>;
  created_at: string;
  updated_at: string;
}

export interface CreatePersonDto {
  name: string;
  company?: string;
  role?: string;
  telegram?: string;
  email?: string;
  phone?: string;
  notes?: string;
  project_id?: number | null;
  project_ids?: number[];
}

export interface PersonHistory {
  person: Person;
  meetings: Array<{ id: number; title: string; date: string }>;
  agreements: Array<{ id: number; description: string; status: string; due_date: string | null }>;
  tasks: Array<{ id: number; title: string; status: string }>;
}
