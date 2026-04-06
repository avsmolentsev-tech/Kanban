import axios from 'axios';
import type { ApiResponse } from '@pis/shared';

export const apiClient = axios.create({ baseURL: '/v1', headers: { 'Content-Type': 'application/json' } });

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
