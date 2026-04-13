import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type { Meeting, CreateMeetingDto } from '@pis/shared';

export interface UpdateMeetingDto {
  title?: string;
  date?: string;
  project_id?: number | null;
  project_ids?: number[];
  summary_raw?: string;
  sync_vault?: boolean;
}

export const meetingsApi = {
  list: (params?: { project?: number; from?: string; to?: string }) => apiGet<Meeting[]>('/meetings', params as Record<string, unknown>),
  create: (dto: CreateMeetingDto) => apiPost<Meeting>('/meetings', dto),
  get: (id: number) => apiGet<Meeting & { agreements: unknown[]; people: unknown[] }>(`/meetings/${id}`),
  update: (id: number, dto: UpdateMeetingDto) => apiPatch<Meeting>(`/meetings/${id}`, dto),
  delete: (id: number) => apiDelete<{ deleted: boolean }>(`/meetings/${id}`),
};
