import { NavLink } from 'react-router-dom';

const tabs = [
  { to: '/', label: 'Задачи', icon: '📋' },
  { to: '/timeline', label: 'Таймлайн', icon: '📊' },
  { to: '/projects', label: 'Проекты', icon: '📁' },
  { to: '/chat', label: 'Чат', icon: '💬' },
  { to: '/more', label: 'Ещё', icon: '☰' },
];

export function MobileNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex z-50 safe-bottom">
      {tabs.map(({ to, label, icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center py-2 text-[10px] font-medium transition-colors ${
              isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-500 dark:text-gray-400'
            }`
          }
        >
          <span className="text-lg leading-none mb-0.5">{icon}</span>
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
