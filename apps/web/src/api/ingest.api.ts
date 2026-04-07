import { apiClient } from './client';
import type { IngestResult, InboxItem, ApiResponse } from '@pis/shared';

export const ingestApi = {
  uploadFile: async (file: File, projectId?: number): Promise<IngestResult> => {
    const form = new FormData();
    form.append('file', file);
    if (projectId != null) form.append('project_id', String(projectId));
    const res = await apiClient.post<ApiResponse<IngestResult>>('/ingest', form, { headers: { 'Content-Type': 'multipart/form-data' } });
    if (!res.data.success || !res.data.data) throw new Error(res.data.error ?? 'Ingest failed');
    return res.data.data;
  },
  pasteText: async (text: string, projectId?: number): Promise<IngestResult> => {
    const res = await apiClient.post<ApiResponse<IngestResult>>('/ingest', { text, project_id: projectId });
    if (!res.data.success || !res.data.data) throw new Error(res.data.error ?? 'Ingest failed');
    return res.data.data;
  },
  ingestUrl: async (url: string, projectId?: number): Promise<IngestResult> => {
    const res = await apiClient.post<ApiResponse<IngestResult>>('/ingest', { url, project_id: projectId });
    if (!res.data.success || !res.data.data) throw new Error(res.data.error ?? 'Ingest failed');
    return res.data.data;
  },
  listRecent: async (): Promise<InboxItem[]> => {
    const res = await apiClient.get<ApiResponse<InboxItem[]>>('/ingest');
    if (!res.data.success || !res.data.data) return [];
    return res.data.data;
  },
  status: (id: number) => apiClient.get<ApiResponse<InboxItem>>(`/ingest/status/${id}`).then(r => r.data.data),
  delete: async (id: number): Promise<void> => {
    await apiClient.delete(`/ingest/${id}`);
  },
};
