import { create } from 'zustand';
import { tasksApi } from '../api/tasks.api';
import type { Task, MoveTaskDto } from '@pis/shared';

interface TasksState {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  fetchTasks: (params?: { project?: number; status?: string; person?: number }) => Promise<void>;
  moveTask: (id: number, dto: MoveTaskDto) => Promise<void>;
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  loading: false,
  error: null,
  fetchTasks: async (params) => {
    set({ loading: true, error: null });
    try {
      const tasks = await tasksApi.list(params);
      set({ tasks, loading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed', loading: false });
    }
  },
  moveTask: async (id, dto) => {
    await tasksApi.move(id, dto);
    await get().fetchTasks();
  },
}));
