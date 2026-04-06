import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { KanbanPage } from './pages/KanbanPage';
import { TimelinePage } from './pages/TimelinePage';
import { ProjectsPage } from './pages/ProjectsPage';
import { MeetingsPage } from './pages/MeetingsPage';
import { PeoplePage } from './pages/PeoplePage';
import { InboxPage } from './pages/InboxPage';
import { IdeasPage } from './pages/IdeasPage';

const nav = [
  { to: '/', label: 'Kanban' },
  { to: '/timeline', label: 'Timeline' },
  { to: '/projects', label: 'Projects' },
  { to: '/meetings', label: 'Meetings' },
  { to: '/people', label: 'People' },
  { to: '/inbox', label: 'Inbox' },
  { to: '/ideas', label: 'Ideas' },
];

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen bg-gray-50">
        <nav className="w-48 bg-white border-r border-gray-200 flex flex-col p-4 gap-1">
          <div className="text-lg font-bold text-indigo-600 mb-6">PIS</div>
          {nav.map(({ to, label }) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) =>
              `px-3 py-2 rounded-md text-sm font-medium transition-colors ${isActive ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'}`
            }>{label}</NavLink>
          ))}
        </nav>
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<KanbanPage />} />
            <Route path="/timeline" element={<TimelinePage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/meetings" element={<MeetingsPage />} />
            <Route path="/people" element={<PeoplePage />} />
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/ideas" element={<IdeasPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
