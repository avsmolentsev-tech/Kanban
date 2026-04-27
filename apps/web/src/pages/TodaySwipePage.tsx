import { useEffect, useState } from 'react';
import { useTasksStore, useProjectsStore } from '../store';
import { tasksApi } from '../api/tasks.api';
import { useLangStore } from '../store/lang.store';
import { Zap } from 'lucide-react';
import type { Task } from '@pis/shared';

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
      // in_progress first, then by priority
      if (a.status === 'in_progress' && b.status !== 'in_progress') return -1;
      if (a.status !== 'in_progress' && b.status === 'in_progress') return 1;
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

  if (!currentTask) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center relative overflow-hidden">
        <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full border border-indigo-400/30 dark:border-white/[0.12]" style={{ animation: 'circleLeft 16s cubic-bezier(0.45,0,0.55,1) infinite' }} />
        <div className="pointer-events-none absolute -top-20 -right-20 w-[350px] h-[350px] rounded-full border border-purple-400/35 dark:border-white/[0.12]" style={{ animation: 'circleLeftSlow 12s cubic-bezier(0.45,0,0.55,1) infinite' }} />
        <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] h-[500px] rounded-full bg-indigo-400/[0.14] dark:bg-white/[0.06] blur-[80px]" style={{ animation: 'circleRight 20s cubic-bezier(0.45,0,0.55,1) infinite' }} />
        <div className="pointer-events-none absolute bottom-10 -left-24 w-[400px] h-[400px] rounded-full border border-purple-400/25 dark:border-white/[0.12]" style={{ animation: 'circleRightSlow 18s cubic-bezier(0.45,0,0.55,1) infinite' }} />
        <div className="text-6xl mb-4">🎉</div>
        <div className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-2">{t('Все задачи сделаны!', 'All tasks done!')}</div>
        <div className="text-sm text-gray-500 dark:text-gray-400">{t('На сегодня задач нет', 'No tasks for today')}</div>
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
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full border border-indigo-400/30 dark:border-white/[0.12]" style={{ animation: 'circleLeft 16s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute -top-20 -right-20 w-[350px] h-[350px] rounded-full border border-purple-400/35 dark:border-white/[0.12]" style={{ animation: 'circleLeftSlow 12s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] h-[500px] rounded-full bg-indigo-400/[0.14] dark:bg-white/[0.06] blur-[80px]" style={{ animation: 'circleRight 20s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-10 -left-24 w-[400px] h-[400px] rounded-full border border-purple-400/25 dark:border-white/[0.12]" style={{ animation: 'circleRightSlow 18s cubic-bezier(0.45,0,0.55,1) infinite' }} />
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
          <div className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-3">{currentTask.title}</div>

          {/* Priority */}
          <div className="flex items-center gap-1 mb-4">
            {[1, 2, 3, 4, 5].map((n) => (
              <span key={n} className={n <= currentTask.priority ? 'text-yellow-400' : 'text-gray-200 dark:text-gray-600'}>⭐</span>
            ))}
          </div>

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
        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-6">
          <button
            onClick={() => handleSwipe('left')}
            disabled={animating}
            className="w-14 h-14 rounded-full bg-white dark:bg-gray-700 shadow-lg border border-gray-200 dark:border-gray-600 flex items-center justify-center text-2xl hover:scale-110 transition-transform disabled:opacity-50"
            title={t('Пропустить', 'Skip')}
          >
            ↻
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
