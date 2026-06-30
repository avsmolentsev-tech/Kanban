import WebApp from '@twa-dev/sdk';

const BASE = import.meta.env.VITE_API_URL || '';

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'X-Telegram-Init-Data': WebApp.initData },
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export interface Task {
  id: number;
  project_name: string;
  prompt: string;
  state: string;
  model: string;
  result_summary: string | null;
  diff_stat: string | null;
  test_result: string | null;
  created_at: string;
  finished_at: string | null;
  duration_ms: number | null;
}

export const api = {
  me: () => apiFetch<{ userId: number }>('/api/me'),
  tasks: () => apiFetch<Task[]>('/api/tasks'),
  task: (id: number) => apiFetch<Task & { events: any[] }>(`/api/tasks/${id}`),
  diff: (id: number) => apiFetch<{ diff: string; task: Task }>(`/api/tasks/${id}/diff`),
  projects: () => apiFetch<Array<{ name: string; path: string; type: string }>>('/api/projects'),
};
