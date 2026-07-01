import WebApp from '@twa-dev/sdk';

const BASE = import.meta.env.VITE_API_URL || '';

async function apiFetch<T>(path: string): Promise<T> {
  const initData = (() => { try { return WebApp.initData || ''; } catch { return ''; } })();
  const res = await fetch(BASE + path, {
    headers: { 'X-Telegram-Init-Data': initData },
  });
  if (!res.ok) throw new Error('API ' + res.status);
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
  plan: string | null;
  created_at: string;
  finished_at: string | null;
  duration_ms: number | null;
}

export interface Project {
  name: string;
  path: string;
  type: string;
}

export interface FileEntry {
  name: string;
  isDirectory: boolean;
}

export const api = {
  me: () => apiFetch<{ userId: number }>('/api/me'),
  tasks: () => apiFetch<Task[]>('/api/tasks'),
  task: (id: number) => apiFetch<Task & { events: any[] }>('/api/tasks/' + id),
  diff: (id: number) => apiFetch<{ diff: string; task: Task }>('/api/tasks/' + id + '/diff'),
  projects: () => apiFetch<Project[]>('/api/projects'),
  projectFiles: (name: string, path?: string) =>
    apiFetch<FileEntry[]>('/api/projects/' + encodeURIComponent(name) + '/files' + (path ? '?path=' + encodeURIComponent(path) : '')),
  projectFile: (name: string, path: string) =>
    apiFetch<{ content: string; path: string }>('/api/projects/' + encodeURIComponent(name) + '/file?path=' + encodeURIComponent(path)),
  createTask: (project_name: string, prompt: string, model?: string) => {
    const initData = (() => { try { return WebApp.initData || ''; } catch { return ''; } })();
    return fetch(BASE + '/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData },
      body: JSON.stringify({ project_name, prompt, model }),
    }).then(r => r.json());
  },
};
