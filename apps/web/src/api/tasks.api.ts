import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type { Task, CreateTaskDto, UpdateTaskDto, MoveTaskDto } from '@pis/shared';

export const tasksApi = {
  list: (params?: { project?: number; status?: string; person?: number }) => apiGet<Task[]>('/tasks', params as Record<string, unknown>),
  create: (dto: CreateTaskDto & { parent_id?: number }) => apiPost<Task>('/tasks', dto),
  update: (id: number, dto: UpdateTaskDto & { parent_id?: number | null }) => apiPatch<Task>(`/tasks/${id}`, dto),
  move: (id: number, dto: MoveTaskDto) => apiPatch<Task>(`/tasks/${id}/move`, dto),
  delete: (id: number) => apiDelete<{ archived: boolean }>(`/tasks/${id}`),
  remove: (id: number) => apiDelete<{ archived: boolean }>(`/tasks/${id}`),
};
