import { useState, useEffect } from 'react';
import { DndContext, rectIntersection, type DragEndEvent, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';
import type { Task, Project, TaskStatus, Person } from '@pis/shared';
import { TaskCard } from './TaskCard';
import { TaskDetailPanel } from './TaskDetailPanel';
import { AddTaskModal } from './AddTaskModal';
import { AddProjectForm } from './AddProjectForm';
import { tasksApi } from '../../api/tasks.api';
import { apiGet, apiPost } from '../../api/client';
import { useLangStore } from '../../store/lang.store';

interface TaskTemplate {
  id: number;
  title: string;
  description: string;
  priority: number;
  project_id: number | null;
  tags: string;
  created_at: string;
}

const COLUMNS: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'done', 'someday'];
function getColLabels(t: (ru: string, en: string) => string): Record<TaskStatus, string> {
  return {
    backlog: t('Бэклог', 'Backlog'),
    todo: t('К выполнению', 'To Do'),
    in_progress: t('В работе', 'In Progress'),
    done: t('Готово', 'Done'),
    someday: t('Когда-нибудь', 'Someday'),
  };
}

interface Props {
  tasks: Task[];
  projects: Project[];
  people: Person[];
  onMoveTask: (id: number, status: TaskStatus, idx: number) => Promise<void>;
  onToggleDone: (id: number, newStatus: TaskStatus) => void;
  onRefresh: () => void;
  onReorderProjects: (items: Array<{ id: number; order_index: number }>) => void;
}

function TemplateDropdown({ onSelect, onRefresh }: { onSelect: (tpl: TaskTemplate) => void; onRefresh: () => void }) {
  const { t } = useLangStore();
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setLoading(true);
      apiGet<TaskTemplate[]>('/templates').then(setTemplates).catch(() => {}).finally(() => setLoading(false));
    }
  }, [open]);

  const handleSelect = async (tpl: TaskTemplate) => {
    try {
      await apiPost(`/templates/${tpl.id}/create-task`);
      onRefresh();
    } catch {}
    setOpen(false);
  };

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        className="text-xs text-gray-400 hover:text-indigo-600 transition-colors"
        title={t('Создать из шаблона', 'Create from template')}
      >
        {t('Из шаблона', 'From template')}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 right-0">
          {loading && <div className="px-3 py-2 text-xs text-gray-400">{t('Загрузка...', 'Loading...')}</div>}
          {!loading && templates.length === 0 && <div className="px-3 py-2 text-xs text-gray-400">{t('Нет шаблонов', 'No templates')}</div>}
          {templates.map((tpl) => (
            <button
              key={tpl.id}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
              onClick={() => handleSelect(tpl)}
            >
              {tpl.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SwimlaneColumn({ droppableId, status, tasks, projects, people, onTaskClick, onToggleDone, projectId, onRefresh, selectedIds }: {
  droppableId: string; status: TaskStatus; tasks: Task[]; projects: Project[]; people: Person[];
  onTaskClick: (t: Task, e: React.MouseEvent) => void; onToggleDone: (id: number, newStatus: TaskStatus) => void; projectId: number | null; onRefresh: () => void; selectedIds?: Set<number>;
}) {
  const { t } = useLangStore();
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });
  const pMap = new Map(projects.map((p) => [p.id, p]));
  const [adding, setAdding] = useState(false);

  return (
    <div ref={setNodeRef} className={`flex flex-col w-64 min-w-[256px] bg-gray-100 dark:bg-gray-800 rounded-xl p-3 transition-colors ${isOver ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''}`}>
      <div className="flex flex-col gap-2 flex-1 min-h-[60px]">
        {tasks.map((task) => (
          <div key={task.id}
            className={selectedIds?.has(task.id) ? 'ring-2 ring-indigo-500 rounded-lg' : ''}
            onClickCapture={(e) => {
              if (e.ctrlKey || e.metaKey || (selectedIds && selectedIds.size > 0)) {
                e.stopPropagation();
                e.preventDefault();
                onTaskClick(task, e);
              }
            }}
          >
            <TaskCard task={task} project={task.project_id ? pMap.get(task.project_id) : undefined}
              onClick={() => { if (!selectedIds || selectedIds.size === 0) onTaskClick(task, {} as React.MouseEvent); }}
              onToggleDone={onToggleDone} dragMode="draggable" />
          </div>
        ))}
      </div>
      {adding ? (
        <div className="mt-2">
          <AddTaskModal status={status} projectId={projectId} people={people} onCreated={() => { setAdding(false); onRefresh(); }} onCancel={() => setAdding(false)} />
        </div>
      ) : (
        <div className="mt-2 flex items-center justify-center gap-2">
          <button onClick={() => setAdding(true)} className="text-xs text-gray-400 hover:text-indigo-600 transition-colors">{t('+ Добавить', '+ Add')}</button>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <TemplateDropdown onSelect={() => {}} onRefresh={onRefresh} />
        </div>
      )}
    </div>
  );
}

function SortableProjectRow({ id, children }: { id: string; children: (dragHandleProps: Record<string, unknown>) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.7 : 1 };
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {children({ ...listeners })}
    </div>
  );
}

export function KanbanBoard({ tasks, projects, people, onMoveTask, onToggleDone, onRefresh, onReorderProjects }: Props) {
  const { t } = useLangStore();
  const COL_LABELS = getColLabels(t);
  const [selected, setSelected] = useState<Task | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const mouseSensor = useSensor(MouseSensor, { activationConstraint: { distance: 8 } });
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } });
  const sensors = useSensors(mouseSensor, touchSensor);
  const pMap = new Map(projects.map((p) => [p.id, p]));

  const handleCardClick = (task: Task, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      // Multi-select mode
      e.preventDefault();
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(task.id)) next.delete(task.id); else next.add(task.id);
        return next;
      });
    } else if (selectedIds.size > 0) {
      // Clear selection on normal click
      setSelectedIds(new Set());
      setSelected(task);
    } else {
      setSelected(task);
    }
  };

  const tasksByProject = new Map<number | null, Task[]>();
  for (const task of tasks) {
    const key = task.project_id;
    if (!tasksByProject.has(key)) tasksByProject.set(key, []);
    tasksByProject.get(key)!.push(task);
  }

  const projectOrder: Array<{ project: Project | null; tasks: Task[] }> = [];
  for (const p of projects) {
    const pts = tasksByProject.get(p.id);
    projectOrder.push({ project: p, tasks: pts ?? [] });
  }
  const unassigned = tasksByProject.get(null);
  if (unassigned && unassigned.length > 0) {
    projectOrder.push({ project: null, tasks: unassigned });
  }

  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    if (activeId.startsWith('project-row-')) {
      if (!overId.startsWith('project-row-')) return;
      const fromIdx = projectOrder.findIndex((p) => `project-row-${p.project?.id ?? 'none'}` === activeId);
      const toIdx = projectOrder.findIndex((p) => `project-row-${p.project?.id ?? 'none'}` === overId);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
      const reordered = arrayMove(projectOrder, fromIdx, toIdx);
      const items = reordered
        .filter((r) => r.project !== null)
        .map((r, i) => ({ id: r.project!.id, order_index: i }));
      onReorderProjects(items);
    } else {
      // Format: {projectId}-{status} e.g. "1-todo", "none-backlog"
      const parts = overId.split('-');
      const status = parts.pop() as TaskStatus;
      const targetProjectPart = parts.join('-');
      if (COLUMNS.includes(status)) {
        const draggedId = Number(active.id);
        const targetProjectId = targetProjectPart === 'none' ? null : Number(targetProjectPart);

        // Move all selected tasks (or just the dragged one)
        const idsToMove = selectedIds.size > 0 && selectedIds.has(draggedId)
          ? [...selectedIds]
          : [draggedId];

        for (const taskId of idsToMove) {
          const task = tasks.find((tk) => tk.id === taskId);
          if (task && task.project_id !== targetProjectId) {
            await tasksApi.update(taskId, { status, project_id: targetProjectId });
          } else {
            await tasksApi.update(taskId, { status });
          }
        }
        setSelectedIds(new Set());
        onRefresh();
      }
    }
  };

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={rectIntersection} onDragEnd={handleDragEnd}>
        <div className="relative overflow-auto h-full">
          {/* Sticky column headers */}
          <div className="sticky top-0 z-30 flex bg-gray-50 border-b border-gray-200 py-2">
            <div className="sticky left-0 z-40 w-40 min-w-[160px] flex-shrink-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md pl-4" />
            {COLUMNS.map((s) => (
              <div key={s} className="w-64 min-w-[256px] mx-2 text-sm font-semibold text-gray-500 text-center">
                {COL_LABELS[s]}
              </div>
            ))}
          </div>

          <div className="p-4 pt-2">
            {/* Project swimlanes */}
            <SortableContext items={projectOrder.map((p) => `project-row-${p.project?.id ?? 'none'}`)} strategy={verticalListSortingStrategy}>
              {projectOrder.map(({ project, tasks: pTasks }) => (
                <SortableProjectRow key={project?.id ?? 'none'} id={`project-row-${project?.id ?? 'none'}`}>
                  {(dragHandleProps) => (
                    <div className="flex mb-4">
                      {/* Sticky project label (left) */}
                      <div className="sticky left-0 top-12 z-20 w-40 min-w-[160px] flex-shrink-0 pr-3 pt-3 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-r border-gray-100 dark:border-gray-700/50 self-start">
                        <div className="flex items-center gap-2">
                          {project && (
                            <div
                              className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 text-base leading-none flex-shrink-0 select-none"
                              {...dragHandleProps}
                            >
                              ⠿
                            </div>
                          )}
                          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: project?.color ?? '#9ca3af' }} />
                          <span className="text-sm font-semibold text-gray-700 truncate">{project?.name ?? t('Без проекта', 'No project')}</span>
                        </div>
                        <div className="text-xs text-gray-400 mt-1 ml-5">{pTasks.length} {t('задач', 'tasks')}</div>
                      </div>
                      <div className="flex gap-4">
                        {COLUMNS.map((status) => (
                          <SwimlaneColumn
                            key={`${project?.id ?? 'none'}-${status}`}
                            droppableId={`${project?.id ?? 'none'}-${status}`}
                            status={status}
                            tasks={pTasks.filter((tk) => tk.status === status)}
                            projects={projects}
                            people={people}
                            onTaskClick={handleCardClick}
                            onToggleDone={onToggleDone}
                            projectId={project?.id ?? null}
                            onRefresh={onRefresh}
                            selectedIds={selectedIds}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </SortableProjectRow>
              ))}
            </SortableContext>

            {/* Add project button */}
            <AddProjectForm onCreated={onRefresh} />
          </div>
        </div>
      </DndContext>
      <TaskDetailPanel
        task={selected}
        projects={projects}
        people={people}
        onClose={() => setSelected(null)}
        onUpdated={() => { onRefresh(); setSelected(null); }}
      />
    </>
  );
}
