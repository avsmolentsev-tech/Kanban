import { NavLink } from 'react-router-dom';
import { useLangStore } from '../../store/lang.store';

const getTabs = (t: (ru: string, en: string) => string) => [
  { to: '/timeline', label: t('Таймлайн', 'Timeline'), icon: '📊' },
  { to: '/habits', label: t('Привычки', 'Habits'), icon: '🔥' },
  { to: '/projects', label: t('Проекты', 'Projects'), icon: '📁' },
  { to: '/chat', label: t('Чат', 'Chat'), icon: '💬' },
  { to: '/more', label: t('Ещё', 'More'), icon: '☰' },
];

export function MobileNav() {
  const { t } = useLangStore();
  const tabs = getTabs(t);
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
