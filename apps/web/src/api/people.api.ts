import { apiGet, apiPost, apiPatch, apiDelete, apiClient } from './client';
import type { Person, CreatePersonDto, PersonHistory } from '@pis/shared';

export const peopleApi = {
  list: () => apiGet<Person[]>('/people'),
  create: (dto: CreatePersonDto) => apiPost<Person>('/people', dto),
  history: (id: number) => apiGet<PersonHistory>(`/people/${id}/history`),
  update: (id: number, data: Partial<CreatePersonDto & { project_id: number | null; meet_asap: boolean; project_ids: number[] }>) => apiPatch<Person>(`/people/${id}`, data),
  delete: (id: number) => apiDelete<{ deleted: boolean }>(`/people/${id}`),
  refreshPhoto: (id: number) => apiPost<{ photo_url: string }>(`/people/${id}/refresh-photo`, {}),
  uploadPhoto: async (id: number, file: File): Promise<{ photo_url: string }> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await apiClient.post(`/people/${id}/photo`, fd);
    return res.data.data;
  },
};
