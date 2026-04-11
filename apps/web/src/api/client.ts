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

// Redirect to login on 401
apiClient.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !window.location.pathname.includes('/login')) {
      // Only redirect if we actually have a token (expired) or the route requires auth
      const token = localStorage.getItem('auth_token');
      if (token) {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
        window.location.href = '/login';
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

export async function apiDelete<T>(url: string): Promise<T> {
  const res = await apiClient.delete<ApiResponse<T>>(url);
  if (!res.data.success || res.data.data === undefined) throw new Error(res.data.error ?? 'API error');
  return res.data.data;
}
