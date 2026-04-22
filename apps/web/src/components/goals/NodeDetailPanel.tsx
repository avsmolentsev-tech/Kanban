import { useState, useEffect } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { apiGet, apiPost, apiPatch, apiDelete } from '../../api/client';

interface NodeData {
  id: string;
  type: string;
  label: string;
  status: string;
  progress: number;
  due_date?: string;
}

interface Props {
  node: NodeData | null;
  onClose: () => void;
  onRefresh: () => void;
}

export function NodeDetailPanel({ node, onClose, onRefresh }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [showAddTask, setShowAddTask] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [projects, setProjects] = useState<Array<{id: number; name: string}>>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [savedMsg, setSavedMsg] = useState('');

  useEffect(() => {
    apiGet<Array<{id: number; name: string}>>('/projects').then((data) => {
      if (Array.isArray(data)) setProjects(data);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (node) {
      setTitle(node.label);
      setStatus(node.status);
      setDueDate(node.due_date ?? '');
      setDescription('');
      setShowAddTask(false);
      setShowConfirmDelete(false);
      setNewTaskTitle('');

      // Fetch current project_id and description
      const [type, idStr] = node.id.split('-');
      const id = Number(idStr);
      if (type === 'task') {
        apiGet<Record<string, unknown>>(`/tasks/${id}`).then((data) => {
          setProjectId((data as Record<string, unknown>)?.project_id as number | null ?? null);
          setDescription(((data as Record<string, unknown>)?.description as string) ?? '');
        }).catch(() => {});
      } else if (type === 'goal') {
        apiGet<Record<string, unknown>>(`/goals/${id}`).then((data) => {
          setProjectId((data as Record<string, unknown>)?.project_id as number | null ?? null);
          setDescription(((data as Record<string, unknown>)?.description as string) ?? '');
        }).catch(() => {});
      }
    }
  }, [node]);

  if (!node) return null;

  const [entityType, entityIdStr] = node.id.split('-');
  const entityId = Number(entityIdStr);
  const isGoal = entityType === 'goal';
  const isTask = entityType === 'task';

  const handleSave = async () => {
    try {
      if (isGoal) {
        await apiPatch(`/goals/${entityId}`, { title, status, due_date: dueDate || undefined, description });
      } else if (isTask) {
        await apiPatch(`/tasks/${entityId}`, { title, status, due_date: dueDate || undefined, description });
      }
      onRefresh();
    } catch { /* ignore */ }
  };

  const handleAddTask = async () => {
    if (!newTaskTitle.trim()) return;
    const body: Record<string, unknown> = { title: newTaskTitle, status: 'todo', priority: 3 };
    if (isTask) {
      body.parent_id = entityId;
    } else {
      body.goal_id = entityId;
    }
    try {
      await apiPost('/tasks', body);
      setNewTaskTitle('');
      setShowAddTask(false);
      onRefresh();
    } catch { /* ignore */ }
  };

  const handleDelete = async () => {
    try {
      if (isGoal) {
        await apiDelete(`/goals/${entityId}`);
      } else if (isTask) {
        await apiDelete(`/tasks/${entityId}`);
      }
      onClose();
      onRefresh();
    } catch { /* ignore */ }
  };

  const statusOptions = isGoal
    ? [{ value: 'active', label: 'Активна' }, { value: 'completed', label: 'Завершена' }]
    : [{ value: 'todo', label: 'Todo' }, { value: 'in_progress', label: 'В работе' }, { value: 'done', label: 'Готово' }];

  return (
    <div className="fixed right-0 top-0 bottom-0 w-80 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 shadow-xl z-[60] p-5 overflow-y-auto">
      <div className="flex justify-between items-center mb-4">
        <span className="text-xs font-medium px-2 py-1 rounded bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 uppercase">{node.type}</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
      </div>

      <input
        className="w-full border rounded-lg px-3 py-2 mb-3 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
        value={title}
        onChange={e => setTitle(e.target.value)}
        onBlur={handleSave}
      />

      <div className="mb-3">
        <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Описание</label>
        <textarea
          className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white resize-y"
          rows={6}
          placeholder="Описание задачи..."
          value={description}
          onChange={e => setDescription(e.target.value)}
          onBlur={handleSave}
        />
      </div>

      <div className="mb-3">
        <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Статус</label>
        <select
          className="w-full border rounded-lg px-3 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          value={status}
          onChange={e => { setStatus(e.target.value); }}
          onBlur={handleSave}
        >
          {statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div className="mb-3">
        <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Дедлайн</label>
        <input
          type="date"
          className="w-full border rounded-lg px-3 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          value={dueDate}
          onChange={e => setDueDate(e.target.value)}
          onBlur={handleSave}
        />
      </div>

      <div className="mb-3">
        <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Проект</label>
        <select
          className="w-full border rounded-lg px-3 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          value={projectId ?? ''}
          onChange={e => {
            const newPid = e.target.value ? Number(e.target.value) : null;
            setProjectId(newPid);
            const [type] = node!.id.split('-');
            const id = Number(node!.id.split('-')[1]);
            if (type === 'task') apiPatch(`/tasks/${id}`, { project_id: newPid }).then(onRefresh);
            else if (type === 'goal') apiPatch(`/goals/${id}`, { project_id: newPid }).then(onRefresh);
          }}
        >
          <option value="">Без проекта</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {savedMsg && <div className="text-xs text-green-500 dark:text-green-400 mb-2 text-center">{savedMsg}</div>}

      {isTask && (
        <div className="mb-3">
          <button
            onClick={async () => {
              let pid = projectId;
              if (!pid) {
                try {
                  const taskData = await apiGet<Record<string, unknown>>(`/tasks/${entityId}`);
                  const goalId = (taskData as Record<string, unknown>)?.goal_id as number | null;
                  const parentId = (taskData as Record<string, unknown>)?.parent_id as number | null;
                  if (goalId) {
                    const goal = await apiGet<Record<string, unknown>>(`/goals/${goalId}`);
                    pid = (goal as Record<string, unknown>)?.project_id as number | null ?? null;
                  } else if (parentId) {
                    const parent = await apiGet<Record<string, unknown>>(`/tasks/${parentId}`);
                    pid = (parent as Record<string, unknown>)?.project_id as number | null ?? null;
                  }
                } catch { /* ignore */ }
              }
              const updates: Record<string, unknown> = {};
              if (status === 'backlog' || !status) updates.status = 'todo';
              if (pid) updates.project_id = pid;
              if (Object.keys(updates).length === 0) updates.status = 'todo';
              await apiPatch(`/tasks/${entityId}`, updates);
              if (pid) setProjectId(pid);
              if (updates.status) setStatus(updates.status as string);
              onRefresh();
              setSavedMsg('Добавлено в Канбан!');
              setTimeout(() => setSavedMsg(''), 2000);
            }}
            className="w-full px-3 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 flex items-center justify-center gap-2"
          >
            Добавить в Канбан
          </button>
        </div>
      )}

      {isGoal && node.type !== 'bhag' && (
        <div className="mb-3">
          <button
            onClick={async () => {
              try {
                const goal = await apiGet<Record<string, unknown>>(`/goals/${entityId}`);
                const pid = (goal as Record<string, unknown>)?.project_id as number | null ?? null;
                await apiPost(`/goals/${entityId}/tasks-to-kanban`, { project_id: pid });
                onRefresh();
                setSavedMsg('Подзадачи добавлены в Канбан!');
                setTimeout(() => setSavedMsg(''), 2000);
              } catch { /* ignore */ }
            }}
            className="w-full px-3 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 flex items-center justify-center gap-2"
          >
            Подзадачи в Канбан
          </button>
        </div>
      )}

      {(node.type === 'bhag' || node.type === 'milestone') && (
        <div className="mb-4">
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
            <span>Прогресс</span>
            <span>{node.progress}%</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div className="h-2 rounded-full bg-green-500 transition-all" style={{ width: `${node.progress}%` }} />
          </div>
        </div>
      )}

      {(node.type === 'bhag' || node.type === 'milestone' || node.type === 'task') && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-3">
          {showAddTask ? (
            <div className="flex gap-2 mb-2">
              <input
                className="flex-1 border rounded-lg px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                placeholder={node.type === 'task' ? 'Новая подзадача...' : 'Новая задача...'}
                value={newTaskTitle}
                onChange={e => setNewTaskTitle(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddTask()}
                autoFocus
              />
              <button onClick={handleAddTask} className="px-2 py-1.5 bg-indigo-600 text-white rounded-lg text-sm">+</button>
            </div>
          ) : (
            <button onClick={() => setShowAddTask(true)} className="flex items-center gap-1 text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
              <Plus size={14} /> {node.type === 'task' ? 'Добавить подзадачу' : 'Добавить задачу'}
            </button>
          )}
        </div>
      )}

      <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-4">
        {showConfirmDelete ? (
          <div className="flex gap-2">
            <button onClick={handleDelete} className="flex-1 px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm">Удалить</button>
            <button onClick={() => setShowConfirmDelete(false)} className="flex-1 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm dark:text-white">Отмена</button>
          </div>
        ) : (
          <button onClick={() => setShowConfirmDelete(true)} className="flex items-center gap-1 text-sm text-red-500 hover:underline">
            <Trash2 size={14} /> Удалить
          </button>
        )}
      </div>
    </div>
  );
}
