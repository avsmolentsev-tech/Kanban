import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { KanbanPage } from './pages/KanbanPage';
import { TimelinePage } from './pages/TimelinePage';
import { ProjectsPage } from './pages/ProjectsPage';
import { MeetingsPage } from './pages/MeetingsPage';
import { PeoplePage } from './pages/PeoplePage';
import { InboxPage } from './pages/InboxPage';
import { IdeasPage } from './pages/IdeasPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { DailyBriefPage } from './pages/DailyBriefPage';
import { CalendarPage } from './pages/CalendarPage';
import { MorePage } from './pages/MorePage';
import { SearchBar } from './components/search/SearchBar';
import { MobileNav } from './components/layout/MobileNav';
import { isTelegramWebApp, initTelegramApp } from './lib/telegram';

const desktopNav = [
  { to: '/', label: 'Kanban' },
  { to: '/timeline', label: 'Timeline' },
  { to: '/projects', label: 'Projects' },
  { to: '/meetings', label: 'Meetings' },
  { to: '/people', label: 'People' },
  { to: '/brief', label: 'Daily Brief' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/inbox', label: 'Inbox' },
  { to: '/ideas', label: 'Ideas' },
  { to: '/documents', label: 'Documents' },
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

  return (
    <BrowserRouter>
      <div
        className="flex h-screen bg-gray-50"
        style={isTg ? { height: 'var(--tg-vh, 100vh)' } : undefined}
      >
        {/* Desktop sidebar */}
        {!useMobileLayout && (
          <nav className="w-48 bg-white border-r border-gray-200 flex flex-col p-4 gap-1">
            <div className="text-lg font-bold text-indigo-600 mb-6">PIS</div>
            {desktopNav.map(({ to, label }) => (
              <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) =>
                `px-3 py-2 rounded-md text-sm font-medium transition-colors ${isActive ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'}`
              }>{label}</NavLink>
            ))}
          </nav>
        )}

        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar */}
          {!useMobileLayout && (
            <div className="flex items-center justify-end px-4 py-2 bg-white border-b">
              <SearchBar />
            </div>
          )}

          {/* Main content */}
          <main className={`flex-1 overflow-auto ${useMobileLayout ? 'pb-16' : ''}`}>
            <Routes>
              <Route path="/" element={<KanbanPage />} />
              <Route path="/timeline" element={<TimelinePage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/meetings" element={<MeetingsPage />} />
              <Route path="/people" element={<PeoplePage />} />
              <Route path="/brief" element={<DailyBriefPage />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/inbox" element={<InboxPage />} />
              <Route path="/ideas" element={<IdeasPage />} />
              <Route path="/documents" element={<DocumentsPage />} />
              <Route path="/more" element={<MorePage />} />
            </Routes>
          </main>

          {/* Mobile bottom nav */}
          {useMobileLayout && <MobileNav />}
        </div>
      </div>
    </BrowserRouter>
  );
}
