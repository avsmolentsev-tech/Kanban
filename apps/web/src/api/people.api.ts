import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type { Person, CreatePersonDto, PersonHistory } from '@pis/shared';

export const peopleApi = {
  list: () => apiGet<Person[]>('/people'),
  create: (dto: CreatePersonDto) => apiPost<Person>('/people', dto),
  history: (id: number) => apiGet<PersonHistory>(`/people/${id}/history`),
  update: (id: number, data: Partial<CreatePersonDto & { project_id: number | null; meet_asap: boolean; project_ids: number[] }>) => apiPatch<Person>(`/people/${id}`, data),
  delete: (id: number) => apiDelete<{ deleted: boolean }>(`/people/${id}`),
};
