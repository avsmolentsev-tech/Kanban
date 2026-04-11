import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { KanbanPage } from './pages/KanbanPage';
import { TimelinePage } from './pages/TimelinePage';
import { ProjectsPage } from './pages/ProjectsPage';
import { MeetingsPage } from './pages/MeetingsPage';
import { PeoplePage } from './pages/PeoplePage';
import { IdeasPage } from './pages/IdeasPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { DailyBriefPage } from './pages/DailyBriefPage';
import { CalendarPage } from './pages/CalendarPage';
import { HabitsPage } from './pages/HabitsPage';
import { HabitsSwipePage } from './pages/HabitsSwipePage';
import { GoalsPage } from './pages/GoalsPage';
import { JournalPage } from './pages/JournalPage';
import { MorePage } from './pages/MorePage';
import { ChatPage } from './pages/ChatPage';
import { DashboardPage } from './pages/DashboardPage';
import { TodaySwipePage } from './pages/TodaySwipePage';
import { StatsPage } from './pages/StatsPage';
import { GanttPage } from './pages/GanttPage';
import { SearchBar } from './components/search/SearchBar';
import { MobileNav } from './components/layout/MobileNav';
import { SettingsMenu } from './components/layout/SettingsMenu';
import { VoiceCommandButton } from './components/voice/VoiceCommandButton';
import { PomodoroTimer } from './components/pomodoro/PomodoroTimer';
import { isTelegramWebApp, initTelegramApp } from './lib/telegram';
import { useHotkeys } from './lib/hotkeys';
import { useTasksStore } from './store/tasks.store';
import { useProjectsStore } from './store/projects.store';
import { useLangStore } from './store/lang.store';
import { useAuthStore } from './store/auth.store';
import { LoginPage } from './pages/LoginPage';

const getDesktopNav = (t: (ru: string, en: string) => string) => [
  { to: '/', label: t('Kanban-доска', 'Kanban Board') },
  { to: '/timeline', label: t('Таймлайн', 'Timeline') },
  { to: '/projects', label: t('Проекты', 'Projects') },
  { to: '/meetings', label: t('Встречи', 'Meetings') },
  { to: '/people', label: t('Люди', 'People') },
  { to: '/brief', label: t('Дневной брифинг', 'Daily Brief') },
  { to: '/calendar', label: t('Календарь', 'Calendar') },
  { to: '/ideas', label: t('Идеи', 'Ideas') },
  { to: '/habits', label: t('Привычки', 'Habits') },
  { to: '/documents', label: t('Документы', 'Documents') },
  { to: '/chat', label: t('Чат', 'Chat') },
  { to: '/goals', label: t('Цели', 'Goals') },
  { to: '/journal', label: t('Ежедневник', 'Journal') },
  { to: '/dashboard', label: t('Дашборд', 'Dashboard') },
  { to: '/stats', label: t('Статистика', 'Statistics') },
  { to: '/gantt', label: t('Гант', 'Gantt') },
];

function HotkeyProvider() {
  useHotkeys();
  return null;
}

export default function App() {
  const [isTg, setIsTg] = useState(false);

  useEffect(() => {
    const tg = isTelegramWebApp();
    setIsTg(tg);
    if (tg) initTelegramApp();

    // Request browser notification permission + check overdue every 30 min
    import('./lib/notifications').then(({ requestNotificationPermission, checkAndNotifyOverdue }) => {
      requestNotificationPermission();
      checkAndNotifyOverdue();
      setInterval(checkAndNotifyOverdue, 30 * 60 * 1000);
    }).catch(() => {});
  }, []);

  // Also treat narrow screens as mobile layout
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const useMobileLayout = isTg || isMobile;

  const { t } = useLangStore();
  const { isAuthenticated, user, logout } = useAuthStore();
  const desktopNav = getDesktopNav(t);

  const fetchTasks = useTasksStore((s) => s.fetchTasks);
  const fetchProjects = useProjectsStore((s) => s.fetchProjects);
  const refreshAll = () => { fetchTasks(); fetchProjects(); };

  // Show login page if not authenticated
  if (!isAuthenticated) {
    return (
      <BrowserRouter>
        <LoginPage />
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <HotkeyProvider />
      <div
        className="flex h-screen bg-gray-50 dark:bg-gray-900"
        style={isTg ? { height: 'var(--tg-vh, 100vh)' } : undefined}
      >
        {/* Desktop sidebar */}
        {!useMobileLayout && isAuthenticated && (
          <nav className="w-48 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col p-4 gap-1">
            <div className="text-lg font-bold text-indigo-600 dark:text-indigo-400 mb-6">PIS</div>
            {desktopNav.map(({ to, label }) => (
              <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) =>
                `px-3 py-2 rounded-md text-sm font-medium transition-colors ${isActive ? 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`
              }>{label}</NavLink>
            ))}
            <div className="mt-auto pt-4 border-t border-gray-200 dark:border-gray-700">
              <div className="text-xs text-gray-500 dark:text-gray-400 truncate px-3">{user?.name || user?.email}</div>
              <button onClick={() => { logout(); window.location.href = '/login'; }}
                className="px-3 py-1.5 text-xs text-red-500 hover:text-red-700 mt-1 w-full text-left">
                {t('Выйти', 'Sign out')}
              </button>
            </div>
          </nav>
        )}

        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar */}
          {!useMobileLayout && isAuthenticated && (
            <div className="flex items-center justify-end gap-2 px-4 py-2 bg-white dark:bg-gray-800 border-b dark:border-gray-700">
              <SearchBar />
              <SettingsMenu />
            </div>
          )}

          {/* Main content */}
          <main className={`flex-1 overflow-auto ${useMobileLayout ? 'pb-16' : ''}`}>
            <Routes>
              <Route path="/" element={useMobileLayout ? <TodaySwipePage /> : <KanbanPage />} />
              <Route path="/kanban" element={<KanbanPage />} />
              <Route path="/timeline" element={<TimelinePage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/meetings" element={<MeetingsPage />} />
              <Route path="/people" element={<PeoplePage />} />
              <Route path="/brief" element={<DailyBriefPage />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/ideas" element={<IdeasPage />} />
              <Route path="/habits" element={useMobileLayout ? <HabitsSwipePage /> : <HabitsPage />} />
              <Route path="/goals" element={<GoalsPage />} />
              <Route path="/journal" element={<JournalPage />} />
              <Route path="/documents" element={<DocumentsPage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/stats" element={<StatsPage />} />
              <Route path="/gantt" element={<GanttPage />} />
              <Route path="/more" element={<MorePage />} />
            </Routes>
          </main>

          {/* Mobile bottom nav */}
          {useMobileLayout && <MobileNav />}
        </div>

        {/* Voice command FAB */}
        <VoiceCommandButton onActionDone={refreshAll} />
        <PomodoroTimer />
      </div>
    </BrowserRouter>
  );
}
