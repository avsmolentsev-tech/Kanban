export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'done';

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
}

export interface MoveTaskDto {
  status: TaskStatus;
  order_index: number;
}
