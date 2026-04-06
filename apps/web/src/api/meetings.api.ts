import { apiGet, apiPost, apiPatch } from './client';
import type { Meeting, CreateMeetingDto } from '@pis/shared';

export interface UpdateMeetingDto {
  title?: string;
  date?: string;
  project_id?: number | null;
  summary_raw?: string;
}

export const meetingsApi = {
  list: (params?: { project?: number; from?: string; to?: string }) => apiGet<Meeting[]>('/meetings', params as Record<string, unknown>),
  create: (dto: CreateMeetingDto) => apiPost<Meeting>('/meetings', dto),
  get: (id: number) => apiGet<Meeting & { agreements: unknown[]; people: unknown[] }>(`/meetings/${id}`),
  update: (id: number, dto: UpdateMeetingDto) => apiPatch<Meeting>(`/meetings/${id}`, dto),
};
