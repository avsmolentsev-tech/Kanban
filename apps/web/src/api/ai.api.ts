import { apiPost, apiGet } from './client';

export const aiApi = {
  chat: (messages: Array<{ role: 'user' | 'assistant'; content: string }>, context?: string) => apiPost<{ reply: string }>('/ai/chat', { messages, context }),
  dailyBrief: () => apiPost<{ brief: string }>('/ai/daily-brief', {}),
  search: (q: string) => apiGet<{ answer: string; sources: string[] }>(`/search?q=${encodeURIComponent(q)}`),
};
