import { useState, useCallback } from 'react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import type { Task, Project, TaskStatus } from '@pis/shared';
import { KanbanColumn } from './KanbanColumn';
import { TaskDetailPanel } from './TaskDetailPanel';

const COLUMNS: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'done'];
const COL_LABELS: Record<TaskStatus, string> = { backlog: 'Backlog', todo: 'To Do', in_progress: 'In Progress', done: 'Done' };

interface Props {
  tasks: Task[];
  projects: Project[];
  onMoveTask: (id: number, status: TaskStatus, idx: number) => Promise<void>;
  onAddTask: (s: TaskStatus) => void;
}

export function KanbanBoard({ tasks, projects, onMoveTask, onAddTask }: Props) {
  const [selected, setSelected] = useState<Task | null>(null);
  const pMap = new Map(projects.map((p) => [p.id, p]));

  // Group tasks by project
  const tasksByProject = new Map<number | null, Task[]>();
  for (const t of tasks) {
    const key = t.project_id;
    if (!tasksByProject.has(key)) tasksByProject.set(key, []);
    tasksByProject.get(key)!.push(t);
  }

  // Order: known projects first (by project order), then unassigned
  const projectOrder: Array<{ project: Project | null; tasks: Task[] }> = [];
  for (const p of projects) {
    const pts = tasksByProject.get(p.id);
    if (pts && pts.length > 0) {
      projectOrder.push({ project: p, tasks: pts });
    }
  }
  const unassigned = tasksByProject.get(null);
  if (unassigned && unassigned.length > 0) {
    projectOrder.push({ project: null, tasks: unassigned });
  }

  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;
    const overId = String(over.id);
    // over.id format: "status" or "projectId-status"
    const status = overId.split('-').pop() as TaskStatus;
    if (COLUMNS.includes(status)) {
      const tasksInCol = tasks.filter((t) => t.status === status);
      await onMoveTask(Number(active.id), status, tasksInCol.length);
    }
  };

  return (
    <>
      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="p-4 overflow-auto">
          {/* Column headers */}
          <div className="flex mb-2 ml-44">
            {COLUMNS.map((s) => (
              <div key={s} className="w-64 min-w-[256px] mx-2 text-sm font-semibold text-gray-500 text-center">
                {COL_LABELS[s]}
              </div>
            ))}
          </div>

          {/* Project swimlanes */}
          {projectOrder.map(({ project, tasks: pTasks }) => (
            <div key={project?.id ?? 'none'} className="flex mb-4">
              {/* Project label on the left */}
              <div className="w-40 min-w-[160px] flex-shrink-0 pr-3 pt-3">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: project?.color ?? '#9ca3af' }} />
                  <span className="text-sm font-semibold text-gray-700 truncate">
                    {project?.name ?? 'No project'}
                  </span>
                </div>
                <div className="text-xs text-gray-400 mt-1 ml-5">
                  {pTasks.length} task{pTasks.length !== 1 ? 's' : ''}
                </div>
              </div>

              {/* 4 columns for this project */}
              <div className="flex gap-4">
                {COLUMNS.map((status) => {
                  const colTasks = pTasks.filter((t) => t.status === status);
                  return (
                    <KanbanColumn
                      key={`${project?.id ?? 'none'}-${status}`}
                      status={status}
                      droppableId={`${project?.id ?? 'none'}-${status}`}
                      tasks={colTasks}
                      projects={projects}
                      onTaskClick={setSelected}
                      onAddTask={onAddTask}
                      hideHeader
                    />
                  );
                })}
              </div>
            </div>
          ))}

          {projectOrder.length === 0 && (
            <div className="text-gray-400 text-sm text-center py-8">No tasks yet</div>
          )}
        </div>
      </DndContext>
      <TaskDetailPanel task={selected} project={selected?.project_id ? pMap.get(selected.project_id) : undefined} onClose={() => setSelected(null)} />
    </>
  );
}
