export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'done' | 'someday';

export interface Task {
  id: number;
  project_id: number | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: number;
  urgency: number;
  due_date: string | null;
  start_date: string | null;
  vault_path: string | null;
  created_at: string;
  updated_at: string;
  archived: boolean;
  order_index: number;
  recurrence?: string | null;
  people?: Array<{ id: number; name: string }>;
  tags?: Array<{ id: number; name: string; color: string }>;
}

export interface CreateTaskDto {
  project_id?: number;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: number;
  urgency?: number;
  due_date?: string;
  start_date?: string;
  person_ids?: number[];
  recurrence?: string | null;
}

export interface UpdateTaskDto {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: number;
  urgency?: number;
  due_date?: string | null;
  start_date?: string | null;
  archived?: boolean;
  project_id?: number | null;
  person_ids?: number[];
  recurrence?: string | null;
}

export interface MoveTaskDto {
  status: TaskStatus;
  order_index: number;
}
