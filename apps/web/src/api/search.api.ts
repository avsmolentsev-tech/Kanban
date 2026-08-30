import { apiGet } from './client';

export interface SearchHit {
  type: string;
  ref_id: number;
  title: string;
  snippet: string;
  rank: number;
}

export const searchApi = {
  search: (q: string) => apiGet<SearchHit[]>(`/search?q=${encodeURIComponent(q)}`),
  reindex: () => apiGet<{ indexed: number }>('/search/reindex'),
};
