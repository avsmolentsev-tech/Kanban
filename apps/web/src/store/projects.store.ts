import { create } from 'zustand';
import { projectsApi } from '../api/projects.api';
import type { Project } from '@pis/shared';

interface ProjectsState {
  projects: Project[];
  loading: boolean;
  fetchProjects: () => Promise<void>;
}

export const useProjectsStore = create<ProjectsState>((set) => ({
  projects: [],
  loading: false,
  fetchProjects: async () => {
    set({ loading: true });
    const projects = await projectsApi.list();
    set({ projects, loading: false });
  },
}));
