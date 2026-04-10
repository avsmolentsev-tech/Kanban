import { useState } from 'react';
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

const COLUMNS: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'done', 'someday'];
const COL_LABELS: Record<TaskStatus, string> = { backlog: 'Бэклог', todo: 'К выполнению', in_progress: 'В работе', done: 'Готово', someday: 'Когда-нибудь' };

interface Props {
  tasks: Task[];
  projects: Project[];
  people: Person[];
  onMoveTask: (id: number, status: TaskStatus, idx: number) => Promise<void>;
  onToggleDone: (id: number, newStatus: TaskStatus) => void;
  onRefresh: () => void;
  onReorderProjects: (items: Array<{ id: number; order_index: number }>) => void;
}

function SwimlaneColumn({ droppableId, status, tasks, projects, people, onTaskClick, onToggleDone, projectId, onRefresh }: {
  droppableId: string; status: TaskStatus; tasks: Task[]; projects: Project[]; people: Person[];
  onTaskClick: (t: Task) => void; onToggleDone: (id: number, newStatus: TaskStatus) => void; projectId: number | null; onRefresh: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });
  const pMap = new Map(projects.map((p) => [p.id, p]));
  const [adding, setAdding] = useState(false);

  return (
    <div ref={setNodeRef} className={`flex flex-col w-64 min-w-[256px] bg-gray-100 rounded-xl p-3 transition-colors ${isOver ? 'bg-indigo-50' : ''}`}>
      <div className="flex flex-col gap-2 flex-1 min-h-[60px]">
        {tasks.map((t) => <TaskCard key={t.id} task={t} project={t.project_id ? pMap.get(t.project_id) : undefined} onClick={() => onTaskClick(t)} onToggleDone={onToggleDone} dragMode="draggable" />)}
      </div>
      {adding ? (
        <div className="mt-2">
          <AddTaskModal status={status} projectId={projectId} people={people} onCreated={() => { setAdding(false); onRefresh(); }} onCancel={() => setAdding(false)} />
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="mt-2 text-xs text-gray-400 hover:text-indigo-600 transition-colors self-center">+ Добавить</button>
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
  const [selected, setSelected] = useState<Task | null>(null);
  const mouseSensor = useSensor(MouseSensor, { activationConstraint: { distance: 8 } });
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } });
  const sensors = useSensors(mouseSensor, touchSensor);
  const pMap = new Map(projects.map((p) => [p.id, p]));

  const tasksByProject = new Map<number | null, Task[]>();
  for (const t of tasks) {
    const key = t.project_id;
    if (!tasksByProject.has(key)) tasksByProject.set(key, []);
    tasksByProject.get(key)!.push(t);
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
      const targetProjectPart = parts.join('-'); // "1", "none", etc.
      if (COLUMNS.includes(status)) {
        const taskId = Number(active.id);
        const targetProjectId = targetProjectPart === 'none' ? null : Number(targetProjectPart);
        const task = tasks.find((t) => t.id === taskId);
        // Update project if moving to a different project swimlane
        if (task && task.project_id !== targetProjectId) {
          await tasksApi.update(taskId, { status, project_id: targetProjectId });
          onRefresh();
        } else {
          const tasksInCol = tasks.filter((t) => t.status === status);
          await onMoveTask(taskId, status, tasksInCol.length);
        }
      }
    }
  };

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={rectIntersection} onDragEnd={handleDragEnd}>
        <div className="relative overflow-auto h-full">
          {/* Sticky column headers */}
          <div className="sticky top-0 z-30 flex bg-gray-50 border-b border-gray-200 py-2">
            <div className="sticky left-0 z-40 w-40 min-w-[160px] flex-shrink-0 bg-gray-50 pl-4" />
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
                      <div className="sticky left-0 z-20 w-40 min-w-[160px] flex-shrink-0 pr-3 pt-3 bg-gray-50 border-r border-gray-100">
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
                          <span className="text-sm font-semibold text-gray-700 truncate">{project?.name ?? 'Без проекта'}</span>
                        </div>
                        <div className="text-xs text-gray-400 mt-1 ml-5">{pTasks.length} задач</div>
                      </div>
                      <div className="flex gap-4">
                        {COLUMNS.map((status) => (
                          <SwimlaneColumn
                            key={`${project?.id ?? 'none'}-${status}`}
                            droppableId={`${project?.id ?? 'none'}-${status}`}
                            status={status}
                            tasks={pTasks.filter((t) => t.status === status)}
                            projects={projects}
                            people={people}
                            onTaskClick={setSelected}
                            onToggleDone={onToggleDone}
                            projectId={project?.id ?? null}
                            onRefresh={onRefresh}
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
