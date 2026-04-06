import { apiGet, apiPost } from './client';
import type { Meeting, CreateMeetingDto } from '@pis/shared';

export const meetingsApi = {
  list: (params?: { project?: number; from?: string; to?: string }) => apiGet<Meeting[]>('/meetings', params as Record<string, unknown>),
  create: (dto: CreateMeetingDto) => apiPost<Meeting>('/meetings', dto),
  get: (id: number) => apiGet<Meeting & { agreements: unknown[]; people: unknown[] }>(`/meetings/${id}`),
};
