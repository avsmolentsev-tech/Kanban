import { useEffect, useState } from 'react';
import { useTasksStore, useProjectsStore } from '../store';
import { tasksApi } from '../api/tasks.api';
import { useLangStore } from '../store/lang.store';
import { Zap, Trash2 } from 'lucide-react';
import type { Task } from '@pis/shared';
import { cleanTaskTitle, priorityPill } from '../lib/format';

export function TodaySwipePage() {
  const { t } = useLangStore();
  const { tasks, fetchTasks } = useTasksStore();
  const { projects, fetchProjects } = useProjectsStore();
  const [index, setIndex] = useState(0);
  const [swipeStart, setSwipeStart] = useState<{ x: number; y: number } | null>(null);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    fetchTasks();
    fetchProjects();
  }, [fetchTasks, fetchProjects]);

  const today = new Date().toISOString().split('T')[0]!;
  // Today's tasks: in_progress first, then todo with due_date <= today or no date
  const todayTasks = tasks
    .filter((t) => !t.archived && (t.status === 'in_progress' || t.status === 'todo'))
    .filter((t) => !t.due_date || t.due_date <= today || t.status === 'in_progress')
    .sort((a, b) => {
      // 1. in_progress first
      if (a.status === 'in_progress' && b.status !== 'in_progress') return -1;
      if (a.status !== 'in_progress' && b.status === 'in_progress') return 1;
      // 2. Due today before others
      const aDueToday = a.due_date === today ? 1 : 0;
      const bDueToday = b.due_date === today ? 1 : 0;
      if (aDueToday !== bDueToday) return bDueToday - aDueToday;
      // 3. Overdue before non-overdue
      const aOverdue = a.due_date && a.due_date < today ? 1 : 0;
      const bOverdue = b.due_date && b.due_date < today ? 1 : 0;
      if (aOverdue !== bOverdue) return bOverdue - aOverdue;
      // 4. By priority
      return b.priority - a.priority;
    });

  const currentTask = todayTasks[index];
  const pMap = new Map(projects.map((p) => [p.id, p]));
  const project = currentTask?.project_id ? pMap.get(currentTask.project_id) : undefined;

  const handleSwipe = async (direction: 'left' | 'right') => {
    if (!currentTask || animating) return;
    setAnimating(true);

    // Animate card flying away
    setOffset({
      x: direction === 'right' ? 600 : -600,
      y: 0,
    });

    setTimeout(async () => {
      if (direction === 'right') {
        // Mark as done
        try {
          await tasksApi.update(currentTask.id, { status: 'done' });
          await fetchTasks();
        } catch {}
      }
      // Move to next
      setIndex((i) => i + 1);
      setOffset({ x: 0, y: 0 });
      setAnimating(false);
    }, 250);
  };

  const handleDelete = async () => {
    if (!currentTask || animating) return;
    if (!confirm(t('Удалить задачу?', 'Delete this task?'))) return;
    setAnimating(true);
    setOffset({ x: 0, y: 600 }); // card flies down
    setTimeout(async () => {
      try {
        await tasksApi.delete(currentTask.id);
        await fetchTasks();
      } catch {}
      setIndex((i) => i + 1);
      setOffset({ x: 0, y: 0 });
      setAnimating(false);
    }, 250);
  };

  if (!currentTask) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center relative overflow-hidden">
        <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] hidden md:block h-[500px] rounded-full bg-indigo-400/15 dark:bg-indigo-400/[0.10]" style={{ animation: 'circleLeft 30s cubic-bezier(0.45,0,0.55,1) infinite' }} />
        <div className="pointer-events-none absolute -top-20 -right-20 w-[350px] hidden md:block h-[350px] rounded-full bg-purple-400/12 dark:bg-purple-400/[0.08]" style={{ animation: 'circleLeftSlow 26s cubic-bezier(0.45,0,0.55,1) infinite' }} />
        <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] hidden md:block h-[500px] rounded-full bg-indigo-400/[0.14] dark:bg-violet-400/[0.09] blur-[80px]" style={{ animation: 'circleRight 34s cubic-bezier(0.45,0,0.55,1) infinite' }} />
        <div className="pointer-events-none absolute bottom-10 -left-24 w-[400px] h-[400px] rounded-full bg-purple-400/10 dark:bg-purple-400/[0.08]" style={{ animation: 'circleRightSlow 28s cubic-bezier(0.45,0,0.55,1) infinite' }} />
        <div className="text-6xl mb-4">🎉</div>
        <div className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-2">{t('Все задачи сделаны!', 'All tasks done!')}</div>
        <div className="text-sm text-gray-500 dark:text-gray-400">{t('Всё разобрано! Отличная работа', 'All cleared! Great job')}</div>
        <button
          onClick={() => { setIndex(0); fetchTasks(); }}
          className="mt-6 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
        >
          {t('Обновить', 'Refresh')}
        </button>
      </div>
    );
  }

  const rotation = offset.x / 20;
  const doneOpacity = Math.min(1, Math.max(0, offset.x / 100));
  const skipOpacity = Math.min(1, Math.max(0, -offset.x / 100));

  return (
    <div className="flex flex-col h-full p-4 relative overflow-hidden">
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] hidden md:block h-[500px] rounded-full bg-indigo-400/15 dark:bg-indigo-400/[0.10]" style={{ animation: 'circleLeft 30s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute -top-20 -right-20 w-[350px] hidden md:block h-[350px] rounded-full bg-purple-400/12 dark:bg-purple-400/[0.08]" style={{ animation: 'circleLeftSlow 26s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] hidden md:block h-[500px] rounded-full bg-indigo-400/[0.14] dark:bg-violet-400/[0.09] blur-[80px]" style={{ animation: 'circleRight 34s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-10 -left-24 w-[400px] h-[400px] rounded-full bg-purple-400/10 dark:bg-purple-400/[0.08]" style={{ animation: 'circleRightSlow 28s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-3 relative z-10">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
          <Zap size={20} className="text-white" />
        </div>
        <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('Сегодня', 'Today')}</h1>
      </div>
      {/* Counter */}
      <div className="text-center mb-4 relative z-10">
        <div className="text-xs text-gray-400 dark:text-gray-500">{t('Задача', 'Task')} {index + 1} {t('из', 'of')} {todayTasks.length}</div>
        <div className="mt-2 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-600 transition-all"
            style={{ width: `${((index + 1) / todayTasks.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Card stack */}
      <div className="flex-1 relative z-10 flex items-center justify-center">
        {/* Next card (preview behind) */}
        {todayTasks[index + 1] && (
          <div
            className="absolute inset-x-4 top-4 bottom-20 bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 opacity-50 scale-95"
          />
        )}

        {/* Current card */}
        <div
          className="absolute inset-x-4 top-4 bottom-20 bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 flex flex-col cursor-grab active:cursor-grabbing select-none"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg)`,
            transition: animating ? 'transform 0.25s ease-out' : 'none',
          }}
          onTouchStart={(e) => {
            if (animating) return;
            const touch = e.touches[0];
            if (touch) setSwipeStart({ x: touch.clientX, y: touch.clientY });
          }}
          onTouchMove={(e) => {
            if (!swipeStart || animating) return;
            const touch = e.touches[0];
            if (!touch) return;
            const dx = touch.clientX - swipeStart.x;
            const dy = touch.clientY - swipeStart.y;
            if (Math.abs(dx) > Math.abs(dy)) {
              setOffset({ x: dx, y: dy * 0.2 });
            }
          }}
          onTouchEnd={() => {
            if (Math.abs(offset.x) > 120) {
              handleSwipe(offset.x > 0 ? 'right' : 'left');
            } else {
              setOffset({ x: 0, y: 0 });
            }
            setSwipeStart(null);
          }}
        >
          {/* Done stamp */}
          <div
            className="absolute top-6 left-6 px-4 py-2 border-4 border-green-500 rounded-xl text-green-500 font-bold text-2xl rotate-[-20deg] pointer-events-none"
            style={{ opacity: doneOpacity }}
          >
            {t('ГОТОВО ✓', 'DONE ✓')}
          </div>

          {/* Skip stamp */}
          <div
            className="absolute top-6 right-6 px-4 py-2 border-4 border-gray-400 rounded-xl text-gray-400 font-bold text-2xl rotate-[20deg] pointer-events-none"
            style={{ opacity: skipOpacity }}
          >
            {t('ДАЛЬШЕ', 'SKIP')}
          </div>

          {/* Project badge */}
          {project && (
            <div className="flex items-center gap-2 mb-4">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: project.color }} />
              <span className="text-sm text-gray-500 dark:text-gray-400">{project.name}</span>
            </div>
          )}

          {/* Title */}
          <div className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-3 w-full break-words [overflow-wrap:anywhere]">{cleanTaskTitle(currentTask.title)}</div>

          {/* Priority */}
          {priorityPill(currentTask.priority) && (
            <div className="mb-4">
              <span className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full ${priorityPill(currentTask.priority)!.cls}`}>
                {priorityPill(currentTask.priority)!.label}
              </span>
            </div>
          )}

          {/* Status */}
          <div className="mb-4">
            <span className={`inline-block text-xs px-2 py-1 rounded-full ${
              currentTask.status === 'in_progress'
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
            }`}>
              {currentTask.status === 'in_progress' ? t('В работе', 'In Progress') : t('К выполнению', 'To Do')}
            </span>
          </div>

          {/* Description */}
          {currentTask.description && (
            <div className="text-sm text-gray-600 dark:text-gray-300 overflow-auto flex-1 whitespace-pre-wrap">
              {currentTask.description}
            </div>
          )}

          {/* Due date */}
          {currentTask.due_date && (
            <div className="text-xs text-gray-400 mt-auto pt-4">📅 {currentTask.due_date}</div>
          )}

          {/* Assignees */}
          {currentTask.people && currentTask.people.length > 0 && (
            <div className="text-xs text-gray-400 mt-1">
              👥 {currentTask.people.map(p => p.name).join(', ')}
            </div>
          )}
        </div>

        {/* Action buttons at bottom */}
        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-5">
          <button
            onClick={() => handleSwipe('left')}
            disabled={animating}
            className="w-12 h-12 rounded-full bg-white dark:bg-gray-700 shadow-lg border border-gray-200 dark:border-gray-600 flex items-center justify-center text-xl hover:scale-110 transition-transform disabled:opacity-50"
            title={t('Пропустить', 'Skip')}
          >
            ↻
          </button>
          <button
            onClick={handleDelete}
            disabled={animating}
            className="w-14 h-14 rounded-full bg-white dark:bg-gray-700 shadow-lg border border-red-200 dark:border-red-800 flex items-center justify-center text-red-500 hover:scale-110 hover:bg-red-50 dark:hover:bg-red-900/30 transition-all disabled:opacity-50"
            title={t('Удалить', 'Delete')}
          >
            <Trash2 size={22} />
          </button>
          <button
            onClick={() => handleSwipe('right')}
            disabled={animating}
            className="w-16 h-16 rounded-full bg-green-500 shadow-lg flex items-center justify-center text-white text-3xl hover:scale-110 transition-transform disabled:opacity-50"
            title={t('Готово', 'Done')}
          >
            ✓
          </button>
        </div>
      </div>

      {/* Hint */}
      <div className="text-center text-xs text-gray-400 dark:text-gray-500 mt-2 relative z-10">
        {t('Свайп вправо → готово, влево → следующая', 'Swipe right → done, left → next')}
      </div>
    </div>
  );
}
