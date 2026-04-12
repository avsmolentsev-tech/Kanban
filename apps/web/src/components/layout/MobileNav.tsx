import { NavLink } from 'react-router-dom';
import { useLangStore } from '../../store/lang.store';
import { BarChart3, Flame, MessageCircle, Users, Menu } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface Tab {
  to: string;
  label: string;
  icon: LucideIcon;
  isCenter?: boolean;
}

const getTabs = (t: (ru: string, en: string) => string): Tab[] => [
  { to: '/timeline', label: t('Таймлайн', 'Timeline'), icon: BarChart3 },
  { to: '/habits', label: t('Привычки', 'Habits'), icon: Flame },
  { to: '/chat', label: t('Чат', 'Chat'), icon: MessageCircle, isCenter: true },
  { to: '/meetings', label: t('Встречи', 'Meetings'), icon: Users },
  { to: '/more', label: t('Ещё', 'More'), icon: Menu },
];

export function MobileNav() {
  const { t } = useLangStore();
  const tabs = getTabs(t);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 safe-bottom">
      {/* Background bar */}
      <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl border-t border-gray-200/50 dark:border-gray-700/50 flex items-end justify-around px-2 pt-2 pb-2">
        {tabs.map(({ to, label, icon: Icon, isCenter }) => {
          if (isCenter) {
            return (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex flex-col items-center -mt-7 ${isActive ? '' : ''}`
                }
              >
                {({ isActive }) => (
                  <>
                    <div className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all ${
                      isActive
                        ? 'bg-indigo-600 shadow-indigo-500/40 scale-105'
                        : 'bg-indigo-500 shadow-indigo-500/25 hover:bg-indigo-600'
                    }`}>
                      <Icon size={26} className="text-white" strokeWidth={2} />
                    </div>
                    <span className={`text-[10px] font-semibold mt-1 ${
                      isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400 dark:text-gray-500'
                    }`}>{label}</span>
                  </>
                )}
              </NavLink>
            );
          }

          return (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center py-1 text-[10px] font-medium transition-colors ${
                  isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400 dark:text-gray-500'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    size={22}
                    strokeWidth={isActive ? 2.5 : 1.8}
                    className={`mb-0.5 transition-colors ${
                      isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400 dark:text-gray-500'
                    }`}
                  />
                  <span className="font-semibold">{label}</span>
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
