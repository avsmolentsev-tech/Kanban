import { apiGet, apiPost, apiPatch, apiDelete } from './client';

export interface DocumentNode {
  id: number;
  title: string;
  body: string;
  project_id: number | null;
  parent_id: number | null;
  category: 'note' | 'reference' | 'template' | 'archive';
  status: string;
  vault_path: string | null;
  created_at: string;
  updated_at: string;
  children?: DocumentNode[];
}

export interface CreateDocumentDto {
  title: string;
  body?: string;
  project_id?: number | null;
  parent_id?: number | null;
  category?: string;
}

export interface UpdateDocumentDto {
  title?: string;
  body?: string;
  project_id?: number | null;
  parent_id?: number | null;
  category?: string;
  status?: string;
}

export const documentsApi = {
  tree: (projectId?: number) =>
    apiGet<DocumentNode[]>('/documents', { project: projectId, tree: 'true' }),

  list: (projectId?: number) =>
    apiGet<DocumentNode[]>('/documents', projectId ? { project: projectId } : undefined),

  get: (id: number) =>
    apiGet<DocumentNode>(`/documents/${id}`),

  create: (dto: CreateDocumentDto) =>
    apiPost<DocumentNode>('/documents', dto),

  update: (id: number, dto: UpdateDocumentDto) =>
    apiPatch<DocumentNode>(`/documents/${id}`, dto),

  delete: (id: number) =>
    apiDelete<{ deleted: boolean }>(`/documents/${id}`),
};
