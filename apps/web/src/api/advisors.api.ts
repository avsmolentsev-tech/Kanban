import { apiGet, apiPost } from './client';

export interface Advisor {
  id: number;
  slug: string;
  name: string;
  domain: string;
  avatar_url: string | null;
  depth: 'deep' | 'light';
}

export interface AdvisorAnalysis {
  advisor_id: number;
  name: string;
  domain?: string;
  avatar_url?: string | null;
  opinion?: string;
  risks?: string[];
  would_do?: string;
  questions?: string[];
  error?: string;
}

export interface AdvisorChatReply {
  session_id: number;
  advisor_id: number;
  name: string;
  reply: string;
}

export interface AdvisorSynthesis {
  agreement: string[];
  disagreement: string[];
  recommendation: string;
}

export const advisorsApi = {
  list: () => apiGet<Advisor[]>('/advisors'),
  analyze: (advisor_ids: number[], opts: { meeting_id?: number; context?: string }) =>
    apiPost<{ analyses: AdvisorAnalysis[] }>('/advisors/analyze', { advisor_ids, ...opts }),
  chat: (advisor_id: number, message: string, opts: { session_id?: number; meeting_id?: number }) =>
    apiPost<AdvisorChatReply>('/advisors/chat', { advisor_id, message, ...opts }),
  synthesize: (analyses: Array<{ name: string; opinion?: string; risks?: string[]; would_do?: string }>) =>
    apiPost<AdvisorSynthesis>('/advisors/synthesize', { analyses }),
};
