import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type { Task, CreateTaskDto, UpdateTaskDto, MoveTaskDto } from '@pis/shared';

export const tasksApi = {
  list: (params?: { project?: number; status?: string; person?: number }) => apiGet<Task[]>('/tasks', params as Record<string, unknown>),
  create: (dto: CreateTaskDto) => apiPost<Task>('/tasks', dto),
  update: (id: number, dto: UpdateTaskDto) => apiPatch<Task>(`/tasks/${id}`, dto),
  move: (id: number, dto: MoveTaskDto) => apiPatch<Task>(`/tasks/${id}/move`, dto),
  remove: (id: number) => apiDelete<{ archived: boolean }>(`/tasks/${id}`),
};
