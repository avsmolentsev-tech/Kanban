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
  hidden?: boolean;
}

export interface FileEntry {
  name: string;
  isDirectory: boolean;
}

export interface ChatMessage {
  id: number;
  project_name: string | null;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
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
  toggleProject: async (name: string, hidden: boolean): Promise<void> => {
    const initData = (() => { try { return WebApp.initData || ''; } catch { return ''; } })();
    await fetch(BASE + '/api/projects/' + encodeURIComponent(name) + '/visibility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData },
      body: JSON.stringify({ hidden }),
    });
  },
  chatHistory: () => apiFetch<ChatMessage[]>('/api/chat'),
  sendChat: async (message: string, project_name?: string): Promise<ChatMessage> => {
    const initData = (() => { try { return WebApp.initData || ''; } catch { return ''; } })();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300000); // 5 min timeout
    try {
      const res = await fetch(BASE + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData },
        body: JSON.stringify({ message, project_name }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error('API ' + res.status);
      return res.json();
    } catch (e: any) {
      clearTimeout(timeout);
      if (e.name === 'AbortError') throw new Error('Timeout 5min');
      throw e;
    }
  },
  clearChat: async (): Promise<void> => {
    const initData = (() => { try { return WebApp.initData || ''; } catch { return ''; } })();
    await fetch(BASE + '/api/chat', {
      method: 'DELETE',
      headers: { 'X-Telegram-Init-Data': initData },
    });
  },
};
