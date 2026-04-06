import { apiGet, apiPost, apiPatch } from './client';
import type { Project, CreateProjectDto, UpdateProjectDto } from '@pis/shared';

export const projectsApi = {
  list: () => apiGet<Project[]>('/projects'),
  create: (dto: CreateProjectDto) => apiPost<Project>('/projects', dto),
  get: (id: number) => apiGet<Project & { tasks: unknown[]; meetings: unknown[] }>(`/projects/${id}`),
  update: (id: number, dto: UpdateProjectDto) => apiPatch<Project>(`/projects/${id}`, dto),
  reorder: (items: Array<{ id: number; order_index: number }>) => apiPatch<Project[]>('/projects/reorder', items),
};
