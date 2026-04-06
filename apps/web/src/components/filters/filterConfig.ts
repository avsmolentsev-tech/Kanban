import type { Project, Person } from '@pis/shared';

export interface FilterValue {
  project?: number;
  person?: number;
  dueDateFrom?: string;
  dueDateTo?: string;
  showArchived?: boolean;
}

export interface FilterConfig {
  key: keyof FilterValue;
  label: string;
  type: 'select' | 'date' | 'boolean';
  getOptions?: (ctx: { projects: Project[]; people: Person[] }) => Array<{ label: string; value: number | string }>;
}

export const FILTER_CONFIG: FilterConfig[] = [
  { key: 'project', label: 'Project', type: 'select', getOptions: ({ projects }) => projects.map((p) => ({ label: p.name, value: p.id })) },
  { key: 'person', label: 'Person', type: 'select', getOptions: ({ people }) => people.map((p) => ({ label: p.name, value: p.id })) },
  { key: 'dueDateFrom', label: 'Due from', type: 'date' },
  { key: 'dueDateTo', label: 'Due to', type: 'date' },
  { key: 'showArchived', label: 'Show archived', type: 'boolean' },
];
