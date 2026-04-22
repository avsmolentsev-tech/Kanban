import axios from 'axios';
import type { ApiResponse } from '@pis/shared';

export const apiClient = axios.create({ baseURL: '/v1', headers: { 'Content-Type': 'application/json' } });

// Attach JWT token to every request if available
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token && config.headers) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

// Redirect to login on 401 — only for auth-related failures, not business logic 401s
apiClient.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !window.location.pathname.includes('/login')) {
      const url = err.config?.url || '';
      // Don't logout on google-calendar or other endpoints that use 401 for "not connected"
      const isAuthFailure = !url.includes('google-calendar') && !url.includes('widget');
      const token = localStorage.getItem('auth_token');
      if (token && isAuthFailure) {
        // Verify token is actually invalid by checking /auth/me
        fetch('/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } })
          .then(r => { if (r.status === 401) { localStorage.removeItem('auth_token'); localStorage.removeItem('auth_user'); window.location.href = '/login'; } })
          .catch(() => {});
      }
    }
    return Promise.reject(err);
  }
);

export async function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const res = await apiClient.get<ApiResponse<T>>(url, { params });
  if (!res.data.success || res.data.data === undefined) throw new Error(res.data.error ?? 'API error');
  return res.data.data;
}

export async function apiPost<T>(url: string, data?: unknown): Promise<T> {
  const res = await apiClient.post<ApiResponse<T>>(url, data);
  if (!res.data.success || res.data.data === undefined) throw new Error(res.data.error ?? 'API error');
  return res.data.data;
}

export async function apiPatch<T>(url: string, data?: unknown): Promise<T> {
  const res = await apiClient.patch<ApiResponse<T>>(url, data);
  if (!res.data.success || res.data.data === undefined) throw new Error(res.data.error ?? 'API error');
  return res.data.data;
}

export async function apiPut<T>(url: string, data?: unknown): Promise<T> {
  const res = await apiClient.put<ApiResponse<T>>(url, data);
  if (!res.data.success || res.data.data === undefined) throw new Error(res.data.error ?? 'API error');
  return res.data.data;
}

export async function apiDelete<T>(url: string): Promise<T> {
  const res = await apiClient.delete<ApiResponse<T>>(url);
  if (!res.data.success || res.data.data === undefined) throw new Error(res.data.error ?? 'API error');
  return res.data.data;
}
