import { apiGet, apiPost } from './client';
import type { Person, CreatePersonDto, PersonHistory } from '@pis/shared';

export const peopleApi = {
  list: () => apiGet<Person[]>('/people'),
  create: (dto: CreatePersonDto) => apiPost<Person>('/people', dto),
  history: (id: number) => apiGet<PersonHistory>(`/people/${id}/history`),
};
