import { apiClient } from './client';
import type { IngestResult, InboxItem, ApiResponse } from '@pis/shared';

export const ingestApi = {
  uploadFile: async (file: File): Promise<IngestResult> => {
    const form = new FormData();
    form.append('file', file);
    const res = await apiClient.post<ApiResponse<IngestResult>>('/ingest', form, { headers: { 'Content-Type': 'multipart/form-data' } });
    if (!res.data.success || !res.data.data) throw new Error(res.data.error ?? 'Ingest failed');
    return res.data.data;
  },
  pasteText: async (text: string): Promise<IngestResult> => {
    const res = await apiClient.post<ApiResponse<IngestResult>>('/ingest', { text });
    if (!res.data.success || !res.data.data) throw new Error(res.data.error ?? 'Ingest failed');
    return res.data.data;
  },
  status: (id: number) => apiClient.get<ApiResponse<InboxItem>>(`/ingest/status/${id}`).then(r => r.data.data),
};
