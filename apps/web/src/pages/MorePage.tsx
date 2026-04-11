import { NavLink } from 'react-router-dom';
import { SettingsMenu } from '../components/layout/SettingsMenu';

const items = [
  { to: '/kanban', label: 'Kanban-доска', icon: '📋' },
  { to: '/timeline', label: 'Таймлайн', icon: '📊' },
  { to: '/calendar', label: 'Календарь', icon: '📅' },
  { to: '/meetings', label: 'Встречи', icon: '🤝' },
  { to: '/people', label: 'Люди', icon: '👥' },
  { to: '/ideas', label: 'Идеи', icon: '💡' },
  { to: '/habits', label: 'Привычки', icon: '🔥' },
  { to: '/goals', label: 'Цели', icon: '🎯' },
  { to: '/documents', label: 'Документы', icon: '📄' },
  { to: '/dashboard', label: 'Дашборд', icon: '📊' },
  { to: '/journal', label: 'Ежедневник', icon: '📓' },
  { to: '/chat', label: 'Чат', icon: '💬' },
  { to: '/stats', label: 'Статистика', icon: '📈' },
  { to: '/gantt', label: 'Диаграмма Ганта', icon: '📊' },
];

export function MorePage() {
  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">Разделы</h1>
        <SettingsMenu />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {items.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            className="flex items-center gap-3 p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 active:bg-gray-50 dark:active:bg-gray-700 text-gray-800 dark:text-gray-100"
          >
            <span className="text-2xl">{icon}</span>
            <span className="font-medium">{label}</span>
          </NavLink>
        ))}
      </div>
    </div>
  );
}
