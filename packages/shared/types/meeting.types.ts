export interface Meeting {
  id: number;
  title: string;
  date: string;
  project_id: number | null;
  summary_raw: string;
  summary_structured: string | null;
  vault_path: string | null;
  source_file: string | null;
  processed: boolean;
  created_at: string;
}

export interface Agreement {
  id: number;
  meeting_id: number;
  task_id: number | null;
  person_id: number | null;
  description: string;
  due_date: string | null;
  status: 'open' | 'done' | 'cancelled';
  created_at: string;
}

export interface MeetingStructured {
  title: string;
  date: string;
  summary: string;
  people: string[];
  agreements: Array<{ description: string; person?: string; due_date?: string }>;
  tasks: string[];
  ideas: string[];
  key_facts: string[];
  tags: string[];
}

export interface CreateMeetingDto {
  title: string;
  date: string;
  project_id?: number;
  project_ids?: number[];
  summary_raw: string;
}
