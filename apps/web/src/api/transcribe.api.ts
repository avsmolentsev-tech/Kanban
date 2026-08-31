import { apiGet, apiPost, apiDelete, apiClient } from './client';

export interface TranscriptionJob {
  id: number;
  filename: string;
  status: 'processing' | 'done' | 'error';
  text?: string | null;
  summary?: string | null;
  error?: string | null;
  created_at: string;
}

export const transcribeApi = {
  upload: async (file: File): Promise<{ id: number; status: string }> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await apiClient.post('/transcribe', fd);
    return res.data.data;
  },
  get: (id: number) => apiGet<TranscriptionJob>(`/transcribe/${id}`),
  summarize: (id: number) => apiPost<{ summary: string }>(`/transcribe/${id}/summarize`, {}),
  list: () => apiGet<TranscriptionJob[]>('/transcribe'),
  delete: (id: number) => apiDelete<{ deleted: boolean }>(`/transcribe/${id}`),
};
