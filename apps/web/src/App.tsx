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
import { MorePage } from './pages/MorePage';
import { ChatPage } from './pages/ChatPage';
import { DashboardPage } from './pages/DashboardPage';
import { TodaySwipePage } from './pages/TodaySwipePage';
import { SearchBar } from './components/search/SearchBar';
import { MobileNav } from './components/layout/MobileNav';
import { SettingsMenu } from './components/layout/SettingsMenu';
import { VoiceCommandButton } from './components/voice/VoiceCommandButton';
import { isTelegramWebApp, initTelegramApp } from './lib/telegram';
import { useTasksStore } from './store/tasks.store';
import { useProjectsStore } from './store/projects.store';

const desktopNav = [
  { to: '/', label: 'Kanban' },
  { to: '/timeline', label: 'Timeline' },
  { to: '/projects', label: 'Projects' },
  { to: '/meetings', label: 'Meetings' },
  { to: '/people', label: 'People' },
  { to: '/brief', label: 'Daily Brief' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/ideas', label: 'Ideas' },
  { to: '/documents', label: 'Documents' },
  { to: '/chat', label: 'Чат' },
  { to: '/dashboard', label: 'Дашборд' },
];

export default function App() {
  const [isTg, setIsTg] = useState(false);

  useEffect(() => {
    const tg = isTelegramWebApp();
    setIsTg(tg);
    if (tg) initTelegramApp();
  }, []);

  // Also treat narrow screens as mobile layout
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const useMobileLayout = isTg || isMobile;

  const fetchTasks = useTasksStore((s) => s.fetchTasks);
  const fetchProjects = useProjectsStore((s) => s.fetchProjects);
  const refreshAll = () => { fetchTasks(); fetchProjects(); };

  return (
    <BrowserRouter>
      <div
        className="flex h-screen bg-gray-50 dark:bg-gray-900"
        style={isTg ? { height: 'var(--tg-vh, 100vh)' } : undefined}
      >
        {/* Desktop sidebar */}
        {!useMobileLayout && (
          <nav className="w-48 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col p-4 gap-1">
            <div className="text-lg font-bold text-indigo-600 dark:text-indigo-400 mb-6">PIS</div>
            {desktopNav.map(({ to, label }) => (
              <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) =>
                `px-3 py-2 rounded-md text-sm font-medium transition-colors ${isActive ? 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`
              }>{label}</NavLink>
            ))}
          </nav>
        )}

        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar */}
          {!useMobileLayout && (
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
              <Route path="/documents" element={<DocumentsPage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/more" element={<MorePage />} />
            </Routes>
          </main>

          {/* Mobile bottom nav */}
          {useMobileLayout && <MobileNav />}
        </div>

        {/* Voice command FAB */}
        <VoiceCommandButton onActionDone={refreshAll} />
      </div>
    </BrowserRouter>
  );
}
