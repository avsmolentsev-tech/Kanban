import { NavLink } from 'react-router-dom';

const items = [
  { to: '/timeline', label: 'Таймлайн', icon: '📊' },
  { to: '/calendar', label: 'Календарь', icon: '📅' },
  { to: '/meetings', label: 'Встречи', icon: '🤝' },
  { to: '/people', label: 'Люди', icon: '👥' },
  { to: '/ideas', label: 'Идеи', icon: '💡' },
  { to: '/documents', label: 'Документы', icon: '📄' },
];

export function MorePage() {
  return (
    <div className="p-4">
      <h1 className="text-lg font-bold mb-4">Разделы</h1>
      <div className="grid grid-cols-2 gap-3">
        {items.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            className="flex items-center gap-3 p-4 bg-white rounded-xl border border-gray-200 active:bg-gray-50"
          >
            <span className="text-2xl">{icon}</span>
            <span className="font-medium text-gray-800">{label}</span>
          </NavLink>
        ))}
      </div>
    </div>
  );
}
