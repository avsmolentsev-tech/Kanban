import { useState, useEffect } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { apiPost, apiPatch, apiDelete } from '../../api/client';

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
  const [status, setStatus] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [showAddTask, setShowAddTask] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  useEffect(() => {
    if (node) {
      setTitle(node.label);
      setStatus(node.status);
      setDueDate(node.due_date ?? '');
      setShowAddTask(false);
      setShowConfirmDelete(false);
      setNewTaskTitle('');
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
        await apiPatch(`/goals/${entityId}`, { title, status, due_date: dueDate || undefined });
      } else if (isTask) {
        await apiPatch(`/tasks/${entityId}`, { title, status, due_date: dueDate || undefined });
      }
      onRefresh();
    } catch { /* ignore */ }
  };

  const handleAddTask = async () => {
    if (!newTaskTitle.trim()) return;
    const goalId = entityId;
    try {
      await apiPost('/tasks', { title: newTaskTitle, status: 'todo', priority: 3, goal_id: goalId });
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

      {(node.type === 'bhag' || node.type === 'milestone') && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-3">
          {showAddTask ? (
            <div className="flex gap-2 mb-2">
              <input
                className="flex-1 border rounded-lg px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                placeholder="Новая задача..."
                value={newTaskTitle}
                onChange={e => setNewTaskTitle(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddTask()}
                autoFocus
              />
              <button onClick={handleAddTask} className="px-2 py-1.5 bg-indigo-600 text-white rounded-lg text-sm">+</button>
            </div>
          ) : (
            <button onClick={() => setShowAddTask(true)} className="flex items-center gap-1 text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
              <Plus size={14} /> Добавить задачу
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
