export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived';

export interface Project {
  id: number;
  name: string;
  description: string;
  status: ProjectStatus;
  color: string;
  vault_path: string | null;
  created_at: string;
  updated_at: string;
  archived: boolean;
}

export interface CreateProjectDto {
  name: string;
  description?: string;
  status?: ProjectStatus;
  color?: string;
}

export interface UpdateProjectDto {
  name?: string;
  description?: string;
  status?: ProjectStatus;
  color?: string;
  archived?: boolean;
}
