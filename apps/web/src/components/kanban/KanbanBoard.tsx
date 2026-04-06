import { useState } from 'react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import type { Task, Project, TaskStatus, Person } from '@pis/shared';
import { TaskCard } from './TaskCard';
import { TaskDetailPanel } from './TaskDetailPanel';
import { AddTaskModal } from './AddTaskModal';
import { AddProjectForm } from './AddProjectForm';

const COLUMNS: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'done'];
const COL_LABELS: Record<TaskStatus, string> = { backlog: 'Backlog', todo: 'To Do', in_progress: 'In Progress', done: 'Done' };

interface Props {
  tasks: Task[];
  projects: Project[];
  people: Person[];
  onMoveTask: (id: number, status: TaskStatus, idx: number) => Promise<void>;
  onRefresh: () => void;
  onMoveProject: (projectId: number | null, direction: 'up' | 'down') => void;
}

function SwimlaneColumn({ droppableId, status, tasks, projects, people, onTaskClick, projectId, onRefresh }: {
  droppableId: string; status: TaskStatus; tasks: Task[]; projects: Project[]; people: Person[];
  onTaskClick: (t: Task) => void; projectId: number | null; onRefresh: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });
  const pMap = new Map(projects.map((p) => [p.id, p]));
  const [adding, setAdding] = useState(false);

  return (
    <div ref={setNodeRef} className={`flex flex-col w-64 min-w-[256px] bg-gray-100 rounded-xl p-3 transition-colors ${isOver ? 'bg-indigo-50' : ''}`}>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2 flex-1 min-h-[60px]">
          {tasks.map((t) => <TaskCard key={t.id} task={t} project={t.project_id ? pMap.get(t.project_id) : undefined} onClick={() => onTaskClick(t)} />)}
        </div>
      </SortableContext>
      {adding ? (
        <div className="mt-2">
          <AddTaskModal status={status} projectId={projectId} people={people} onCreated={() => { setAdding(false); onRefresh(); }} onCancel={() => setAdding(false)} />
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="mt-2 text-xs text-gray-400 hover:text-indigo-600 transition-colors self-center">+ Add</button>
      )}
    </div>
  );
}

export function KanbanBoard({ tasks, projects, people, onMoveTask, onRefresh, onMoveProject }: Props) {
  const [selected, setSelected] = useState<Task | null>(null);
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
    const overId = String(over.id);
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
              <div className="w-40 min-w-[160px] flex-shrink-0 pr-3 pt-3">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: project?.color ?? '#9ca3af' }} />
                  <span className="text-sm font-semibold text-gray-700 truncate">{project?.name ?? 'No project'}</span>
                  {project && (
                    <div className="flex gap-0.5 ml-auto">
                      <button onClick={() => onMoveProject(project.id, 'up')} className="text-gray-300 hover:text-gray-600 text-xs leading-none">▲</button>
                      <button onClick={() => onMoveProject(project.id, 'down')} className="text-gray-300 hover:text-gray-600 text-xs leading-none">▼</button>
                    </div>
                  )}
                </div>
                <div className="text-xs text-gray-400 mt-1 ml-5">{pTasks.length} task{pTasks.length !== 1 ? 's' : ''}</div>
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
                    projectId={project?.id ?? null}
                    onRefresh={onRefresh}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* Add project button */}
          <AddProjectForm onCreated={onRefresh} />
        </div>
      </DndContext>
      <TaskDetailPanel
        task={selected}
        project={selected?.project_id ? pMap.get(selected.project_id) : undefined}
        people={people}
        onClose={() => setSelected(null)}
        onUpdated={() => { onRefresh(); setSelected(null); }}
      />
    </>
  );
}
