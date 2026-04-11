import { NavLink } from 'react-router-dom';
import { SettingsMenu } from '../components/layout/SettingsMenu';
import { useLangStore } from '../store/lang.store';

const getItems = (t: (ru: string, en: string) => string) => [
  { to: '/kanban', label: t('Kanban-доска', 'Kanban Board'), icon: '📋' },
  { to: '/timeline', label: t('Таймлайн', 'Timeline'), icon: '📊' },
  { to: '/calendar', label: t('Календарь', 'Calendar'), icon: '📅' },
  { to: '/meetings', label: t('Встречи', 'Meetings'), icon: '🤝' },
  { to: '/people', label: t('Люди', 'People'), icon: '👥' },
  { to: '/ideas', label: t('Идеи', 'Ideas'), icon: '💡' },
  { to: '/habits', label: t('Привычки', 'Habits'), icon: '🔥' },
  { to: '/goals', label: t('Цели', 'Goals'), icon: '🎯' },
  { to: '/documents', label: t('Документы', 'Documents'), icon: '📄' },
  { to: '/dashboard', label: t('Дашборд', 'Dashboard'), icon: '📊' },
  { to: '/journal', label: t('Ежедневник', 'Journal'), icon: '📓' },
  { to: '/chat', label: t('Чат', 'Chat'), icon: '💬' },
  { to: '/stats', label: t('Статистика', 'Statistics'), icon: '📈' },
  { to: '/gantt', label: t('Диаграмма Ганта', 'Gantt Chart'), icon: '📊' },
];

export function MorePage() {
  const { t } = useLangStore();
  const items = getItems(t);
  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('Разделы', 'Sections')}</h1>
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
