import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
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
import { ProfilePage } from './pages/ProfilePage';
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
import {
  LayoutDashboard, Columns3, BarChart3, FolderKanban, Users, CalendarDays,
  Lightbulb, FileText, MessageCircle, Target, BookOpen, GanttChart,
  Flame, Sun, PieChart, LogOut, ChevronLeft, ChevronRight
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const getDesktopNav = (t: (ru: string, en: string) => string): NavSection[] => [
  {
    title: t('Работа', 'Work'),
    items: [
      { to: '/', label: t('Kanban', 'Kanban'), icon: Columns3 },
      { to: '/timeline', label: t('Таймлайн', 'Timeline'), icon: BarChart3 },
      { to: '/projects', label: t('Проекты', 'Projects'), icon: FolderKanban },
      { to: '/gantt', label: t('Гант', 'Gantt'), icon: GanttChart },
    ],
  },
  {
    title: t('Общение', 'Social'),
    items: [
      { to: '/chat', label: t('AI Чат', 'AI Chat'), icon: MessageCircle },
      { to: '/meetings', label: t('Встречи', 'Meetings'), icon: Users },
      { to: '/people', label: t('Люди', 'People'), icon: Users },
    ],
  },
  {
    title: t('Планирование', 'Planning'),
    items: [
      { to: '/calendar', label: t('Календарь', 'Calendar'), icon: CalendarDays },
      { to: '/brief', label: t('Брифинг', 'Brief'), icon: Sun },
      { to: '/goals', label: t('Цели', 'Goals'), icon: Target },
    ],
  },
  {
    title: t('Знания', 'Knowledge'),
    items: [
      { to: '/ideas', label: t('Идеи', 'Ideas'), icon: Lightbulb },
      { to: '/documents', label: t('Документы', 'Docs'), icon: FileText },
      { to: '/journal', label: t('Дневник', 'Journal'), icon: BookOpen },
    ],
  },
  {
    title: t('Трекинг', 'Tracking'),
    items: [
      { to: '/habits', label: t('Привычки', 'Habits'), icon: Flame },
      { to: '/dashboard', label: t('Дашборд', 'Dashboard'), icon: LayoutDashboard },
      { to: '/stats', label: t('Статистика', 'Stats'), icon: PieChart },
    ],
  },
];

function HotkeyProvider() {
  useHotkeys();
  return null;
}

function HideOnChat({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  if (location.pathname === '/chat') return null;
  return <>{children}</>;
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
  const { isAuthenticated, user, logout, login } = useAuthStore();
  const desktopNav = getDesktopNav(t);

  // Auto-refresh user data from server on mount
  useEffect(() => {
    if (!isAuthenticated) return;
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    fetch('/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { if (d.success && d.data) { login(token, d.data); } })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
          <nav className="w-56 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-r border-gray-200/50 dark:border-gray-700/50 flex flex-col">
            {/* Logo */}
            <div className="flex items-center gap-3 px-5 py-5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <span className="text-white font-bold text-sm">P</span>
              </div>
              <div>
                <div className="text-sm font-bold text-gray-800 dark:text-gray-100">PIS</div>
                <div className="text-[10px] text-gray-400">Intelligence System</div>
              </div>
            </div>

            {/* Nav sections */}
            <div className="flex-1 overflow-auto px-3 space-y-4 pb-4">
              {desktopNav.map(section => (
                <div key={section.title}>
                  <div className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-2 mb-1">{section.title}</div>
                  {section.items.map(({ to, label, icon: Icon }) => (
                    <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) =>
                      `flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] font-medium transition-all ${
                        isActive
                          ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-800 dark:hover:text-gray-200'
                      }`
                    }>
                      {({ isActive }) => (
                        <>
                          <Icon size={16} strokeWidth={isActive ? 2.5 : 1.8} className={isActive ? 'text-indigo-600 dark:text-indigo-400' : ''} />
                          {label}
                        </>
                      )}
                    </NavLink>
                  ))}
                </div>
              ))}
            </div>

            {/* User footer */}
            <div className="border-t border-gray-200/50 dark:border-gray-700/50 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  {(user?.name || user?.email || '?')[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">{user?.name || user?.email}</div>
                  <div className="text-[10px] text-gray-400 truncate">{user?.email}</div>
                </div>
                <button onClick={() => { logout(); window.location.href = '/login'; }}
                  className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 transition-colors"
                  title={t('Выйти', 'Sign out')}>
                  <LogOut size={14} />
                </button>
              </div>
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
              <Route path="/profile" element={<ProfilePage />} />
            </Routes>
          </main>

          {/* Mobile bottom nav */}
          {useMobileLayout && <MobileNav />}
        </div>

        {/* Voice command FAB — hidden on chat page */}
        <HideOnChat><VoiceCommandButton onActionDone={refreshAll} /></HideOnChat>
        <PomodoroTimer />
      </div>
    </BrowserRouter>
  );
}
