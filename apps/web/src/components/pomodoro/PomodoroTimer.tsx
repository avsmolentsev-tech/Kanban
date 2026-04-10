import { useEffect, useState, useRef, useCallback } from 'react';

type PomodoroState = 'idle' | 'work' | 'break' | 'long_break';
type TimerMode = 'compact' | 'full';

const DURATIONS: Record<PomodoroState, number> = {
  idle: 0,
  work: 25 * 60,
  break: 5 * 60,
  long_break: 15 * 60,
};

const STATE_LABELS: Record<PomodoroState, string> = {
  idle: 'Помодоро',
  work: 'Работа',
  break: 'Перерыв',
  long_break: 'Длинный перерыв',
};

const STATE_COLORS: Record<PomodoroState, string> = {
  idle: '#6366f1',
  work: '#ef4444',
  break: '#22c55e',
  long_break: '#3b82f6',
};

interface PomodoroData {
  state: PomodoroState;
  remaining: number;
  running: boolean;
  sessions: number;
  taskName: string | null;
  savedAt: number;
}

function loadState(): PomodoroData {
  try {
    const raw = localStorage.getItem('pomodoro');
    if (raw) {
      const data = JSON.parse(raw) as PomodoroData;
      // Adjust remaining time based on elapsed time if timer was running
      if (data.running && data.savedAt) {
        const elapsed = Math.floor((Date.now() - data.savedAt) / 1000);
        data.remaining = Math.max(0, data.remaining - elapsed);
      }
      return data;
    }
  } catch {}
  return { state: 'idle', remaining: 0, running: false, sessions: 0, taskName: null, savedAt: Date.now() };
}

function saveState(data: PomodoroData) {
  localStorage.setItem('pomodoro', JSON.stringify({ ...data, savedAt: Date.now() }));
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function CircularProgress({ progress, color, size, children }: { progress: number; color: string; size: number; children: React.ReactNode }) {
  const strokeWidth = size < 100 ? 3 : 4;
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor"
          className="text-gray-200 dark:text-gray-700" strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color}
          strokeWidth={strokeWidth} strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" className="transition-all duration-1000" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

function sendNotification(title: string) {
  // Browser notification
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body: 'Помодоро таймер', icon: '/icons/icon-192.png' });
  }
  // Audio beep
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800;
    gain.gain.value = 0.3;
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
    setTimeout(() => {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.frequency.value = 1000;
      gain2.gain.value = 0.3;
      osc2.start();
      osc2.stop(ctx.currentTime + 0.3);
    }, 400);
  } catch {}
}

export function PomodoroTimer() {
  const [data, setData] = useState<PomodoroData>(loadState);
  const [mode, setMode] = useState<TimerMode>('compact');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { state, remaining, running, sessions, taskName } = data;

  const update = useCallback((partial: Partial<PomodoroData>) => {
    setData((prev) => {
      const next = { ...prev, ...partial };
      saveState(next);
      return next;
    });
  }, []);

  // Request notification permission once
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Timer tick
  useEffect(() => {
    if (running && remaining > 0) {
      intervalRef.current = setInterval(() => {
        setData((prev) => {
          if (prev.remaining <= 1) {
            // Timer ended
            const isWork = prev.state === 'work';
            const newSessions = isWork ? prev.sessions + 1 : prev.sessions;
            const nextState: PomodoroState = isWork
              ? (newSessions % 4 === 0 ? 'long_break' : 'break')
              : 'idle';
            const msg = isWork ? 'Время перерыва!' : 'Перерыв окончен!';
            sendNotification(msg);
            const next = {
              ...prev,
              state: nextState,
              remaining: nextState === 'idle' ? 0 : DURATIONS[nextState],
              running: nextState !== 'idle',
              sessions: newSessions,
            };
            saveState(next);
            return next;
          }
          const next = { ...prev, remaining: prev.remaining - 1 };
          // Save every 10 seconds to avoid excessive writes
          if (next.remaining % 10 === 0) saveState(next);
          return next;
        });
      }, 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running, remaining]);

  const startWork = () => update({ state: 'work', remaining: DURATIONS.work, running: true });
  const pause = () => update({ running: false });
  const resume = () => update({ running: true });
  const reset = () => update({ state: 'idle', remaining: 0, running: false, sessions: 0, taskName: null });

  const progress = state === 'idle' ? 0 : 1 - remaining / DURATIONS[state];
  const color = STATE_COLORS[state];

  if (mode === 'compact') {
    return (
      <button
        onClick={() => {
          if (state === 'idle') startWork();
          else setMode('full');
        }}
        className="fixed bottom-20 right-4 md:bottom-4 md:right-16 z-40 shadow-lg rounded-full"
        title="Помодоро"
      >
        <CircularProgress progress={progress} color={color} size={48}>
          <span className="text-[10px] font-bold text-gray-700 dark:text-gray-200">
            {state === 'idle' ? '🍅' : formatTime(remaining)}
          </span>
        </CircularProgress>
      </button>
    );
  }

  return (
    <div className="fixed bottom-20 right-4 md:bottom-4 md:right-16 z-40 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl p-4 w-64">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          {STATE_LABELS[state]}
        </span>
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-400">Сессий: {sessions}</span>
          <button onClick={() => setMode('compact')} className="ml-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none">&times;</button>
        </div>
      </div>

      {/* Circular timer */}
      <div className="flex justify-center mb-3">
        <CircularProgress progress={progress} color={color} size={120}>
          <span className="text-2xl font-bold text-gray-800 dark:text-gray-100">
            {state === 'idle' ? '25:00' : formatTime(remaining)}
          </span>
        </CircularProgress>
      </div>

      {/* Task name */}
      {taskName && (
        <div className="text-xs text-gray-500 dark:text-gray-400 text-center mb-2 truncate">
          Задача: {taskName}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-center gap-2">
        {state === 'idle' ? (
          <button onClick={startWork}
            className="px-4 py-1.5 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition-colors">
            Старт
          </button>
        ) : (
          <>
            {running ? (
              <button onClick={pause}
                className="px-3 py-1.5 bg-yellow-500 text-white rounded-lg text-sm font-medium hover:bg-yellow-600 transition-colors">
                Пауза
              </button>
            ) : (
              <button onClick={resume}
                className="px-3 py-1.5 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600 transition-colors">
                Продолжить
              </button>
            )}
            <button onClick={reset}
              className="px-3 py-1.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">
              Сброс
            </button>
          </>
        )}
      </div>
    </div>
  );
}
