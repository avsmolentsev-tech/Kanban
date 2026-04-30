import { create } from 'zustand';
import { documentsApi } from '../api/documents.api';
import type { DocumentNode, CreateDocumentDto, UpdateDocumentDto } from '../api/documents.api';
import { apiGet, apiPost, apiPatch } from '../api/client';

interface Meeting {
  id: number;
  title: string;
  date: string;
  project_id: number | null;
  summary_raw: string;
  summary_structured: string | null;
}

interface Idea {
  id: number;
  title: string;
  body: string;
  category: string;
  project_id: number | null;
  source_meeting_id: number | null;
  status: string;
}

type SidebarItemType = 'document' | 'meeting' | 'idea';

interface ActiveItem {
  type: SidebarItemType;
  id: number;
}

interface ProjectData {
  documents: DocumentNode[];
  meetings: Meeting[];
  ideas: Idea[];
}

interface DocumentsState {
  projectData: Map<number | null, ProjectData>;
  expandedProjects: Set<number | null>;
  activeItem: ActiveItem | null;
  activeDocument: DocumentNode | null;
  activeMeeting: Meeting | null;
  activeIdea: Idea | null;
  saving: boolean;
  lastSaved: string | null;
  loadProjectData: (projectId: number | null) => Promise<void>;
  toggleProject: (projectId: number | null) => void;
  setActiveDocument: (doc: DocumentNode) => void;
  setActiveMeeting: (meeting: Meeting) => void;
  setActiveIdea: (idea: Idea) => void;
  clearActive: () => void;
  createDocument: (dto: CreateDocumentDto) => Promise<DocumentNode>;
  updateDocument: (id: number, dto: UpdateDocumentDto) => Promise<void>;
  deleteDocument: (id: number) => Promise<void>;
  setSaving: (saving: boolean) => void;
  setLastSaved: (ts: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  editingMeeting: boolean;
  editingIdea: boolean;
  setEditingMeeting: (editing: boolean) => void;
  setEditingIdea: (editing: boolean) => void;
  createMeeting: (projectId: number | null) => Promise<void>;
  createIdea: (projectId: number | null) => Promise<void>;
  deleteIdea: (id: number, projectId: number | null) => Promise<void>;
  updateMeeting: (id: number, data: Record<string, unknown>) => Promise<void>;
  updateIdea: (id: number, data: Record<string, unknown>) => Promise<void>;
}

export const useDocumentsStore = create<DocumentsState>((set, get) => ({
  projectData: new Map(),
  expandedProjects: new Set(),
  activeItem: null,
  activeDocument: null,
  activeMeeting: null,
  activeIdea: null,
  saving: false,
  lastSaved: null,

  loadProjectData: async (projectId) => {
    const [documents, meetings, ideas] = await Promise.all([
      documentsApi.tree(projectId ?? undefined),
      apiGet<Meeting[]>('/meetings', projectId !== null ? { project: projectId } : undefined),
      apiGet<Idea[]>('/ideas', projectId !== null ? { project: projectId } : undefined),
    ]);
    set((state) => {
      const newMap = new Map(state.projectData);
      newMap.set(projectId, { documents, meetings, ideas });
      return { projectData: newMap };
    });
  },

  toggleProject: (projectId) => {
    set((state) => {
      const next = new Set(state.expandedProjects);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
        if (!state.projectData.has(projectId)) {
          get().loadProjectData(projectId);
        }
      }
      return { expandedProjects: next };
    });
  },

  setActiveDocument: (doc) => {
    set({
      activeItem: { type: 'document', id: doc.id },
      activeDocument: doc,
      activeMeeting: null,
      activeIdea: null,
    });
  },

  setActiveMeeting: (meeting) => {
    set({
      activeItem: { type: 'meeting', id: meeting.id },
      activeDocument: null,
      activeMeeting: meeting,
      activeIdea: null,
    });
  },

  setActiveIdea: (idea) => {
    set({
      activeItem: { type: 'idea', id: idea.id },
      activeDocument: null,
      activeMeeting: null,
      activeIdea: idea,
    });
  },

  clearActive: () => {
    set({ activeItem: null, activeDocument: null, activeMeeting: null, activeIdea: null });
  },

  createDocument: async (dto) => {
    const doc = await documentsApi.create(dto);
    await get().loadProjectData(dto.project_id ?? null);
    return doc;
  },

  updateDocument: async (id, dto) => {
    set({ saving: true });
    const updated = await documentsApi.update(id, dto);
    set({ saving: false, lastSaved: new Date().toISOString(), activeDocument: updated });
    const projId = dto.project_id !== undefined ? dto.project_id : get().activeDocument?.project_id ?? null;
    await get().loadProjectData(projId);
  },

  deleteDocument: async (id) => {
    const doc = get().activeDocument;
    await documentsApi.delete(id);
    if (get().activeItem?.id === id) get().clearActive();
    if (doc) await get().loadProjectData(doc.project_id);
  },

  setSaving: (saving) => set({ saving }),
  setLastSaved: (ts) => set({ lastSaved: ts }),

  searchQuery: '',
  editingMeeting: false,
  editingIdea: false,
  setSearchQuery: (query) => set({ searchQuery: query }),
  setEditingMeeting: (editing) => set({ editingMeeting: editing }),
  setEditingIdea: (editing) => set({ editingIdea: editing }),

  createMeeting: async (projectId) => {
    const date = new Date().toISOString().split('T')[0];
    const meeting = await apiPost<Meeting>('/meetings', { title: 'Новая встреча', date, project_id: projectId });
    await get().loadProjectData(projectId);
    set({ activeItem: { type: 'meeting', id: meeting.id }, activeDocument: null, activeMeeting: meeting, activeIdea: null, editingMeeting: true });
  },

  createIdea: async (projectId) => {
    const idea = await apiPost<Idea>('/ideas', { title: 'Новая идея', project_id: projectId });
    await get().loadProjectData(projectId);
    set({ activeItem: { type: 'idea', id: idea.id }, activeDocument: null, activeMeeting: null, activeIdea: idea, editingIdea: true });
  },

  deleteIdea: async (id, projectId) => {
    await apiPatch(`/ideas/${id}`, { archived: true });
    if (get().activeItem?.type === 'idea' && get().activeItem?.id === id) get().clearActive();
    await get().loadProjectData(projectId);
  },

  updateMeeting: async (id, data) => {
    set({ saving: true });
    const updated = await apiPatch<Meeting>(`/meetings/${id}`, data);
    set({ saving: false, lastSaved: new Date().toISOString(), activeMeeting: updated });
    const projId = get().activeMeeting?.project_id ?? null;
    await get().loadProjectData(projId);
  },

  updateIdea: async (id, data) => {
    set({ saving: true });
    const updated = await apiPatch<Idea>(`/ideas/${id}`, data);
    set({ saving: false, lastSaved: new Date().toISOString(), activeIdea: updated });
    const projId = get().activeIdea?.project_id ?? null;
    await get().loadProjectData(projId);
  },
}));

export type { Meeting as SidebarMeeting, Idea as SidebarIdea };
