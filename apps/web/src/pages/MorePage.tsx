import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import { SettingsMenu } from '../components/layout/SettingsMenu';
import { useLangStore } from '../store/lang.store';
import { useAuthStore } from '../store/auth.store';
import {
  Columns3, BarChart3, CalendarDays, Users, Lightbulb, Flame,
  Target, FileText, LayoutDashboard, BookOpen, MessageCircle,
  PieChart, GanttChart, FolderKanban, Sun, LogOut, Shield
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface MenuItem {
  to: string;
  label: string;
  icon: LucideIcon;
  color: string;
}

const getItems = (t: (ru: string, en: string) => string): MenuItem[] => [
  { to: '/kanban', label: t('Kanban', 'Kanban'), icon: Columns3, color: 'from-indigo-500 to-indigo-600' },
  { to: '/timeline', label: t('Таймлайн', 'Timeline'), icon: BarChart3, color: 'from-blue-500 to-blue-600' },
  { to: '/projects', label: t('Проекты', 'Projects'), icon: FolderKanban, color: 'from-violet-500 to-violet-600' },
  { to: '/calendar', label: t('Календарь', 'Calendar'), icon: CalendarDays, color: 'from-cyan-500 to-cyan-600' },
  { to: '/meetings', label: t('Встречи', 'Meetings'), icon: Users, color: 'from-emerald-500 to-emerald-600' },
  { to: '/people', label: t('Люди', 'People'), icon: Users, color: 'from-teal-500 to-teal-600' },
  { to: '/ideas', label: t('Идеи', 'Ideas'), icon: Lightbulb, color: 'from-amber-500 to-amber-600' },
  { to: '/habits', label: t('Привычки', 'Habits'), icon: Flame, color: 'from-orange-500 to-orange-600' },
  { to: '/goals', label: t('Цели', 'Goals'), icon: Target, color: 'from-rose-500 to-rose-600' },
  { to: '/documents', label: t('Документы', 'Docs'), icon: FileText, color: 'from-slate-500 to-slate-600' },
  { to: '/dashboard', label: t('Дашборд', 'Dashboard'), icon: LayoutDashboard, color: 'from-purple-500 to-purple-600' },
  { to: '/journal', label: t('Дневник', 'Journal'), icon: BookOpen, color: 'from-pink-500 to-pink-600' },
  { to: '/brief', label: t('Брифинг', 'Brief'), icon: Sun, color: 'from-yellow-500 to-yellow-600' },
  { to: '/chat', label: t('AI Чат', 'AI Chat'), icon: MessageCircle, color: 'from-indigo-500 to-purple-600' },
  { to: '/stats', label: t('Статистика', 'Stats'), icon: PieChart, color: 'from-sky-500 to-sky-600' },
  { to: '/gantt', label: t('Гант', 'Gantt'), icon: GanttChart, color: 'from-green-500 to-green-600' },
];

export function MorePage() {
  const { t } = useLangStore();
  const { user, logout } = useAuthStore();
  const items = getItems(t);

  return (
    <div className="relative overflow-hidden p-4 pb-24">
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full bg-indigo-400/15 dark:bg-white/[0.07]" style={{ animation: 'circleLeft 30s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute -top-20 -right-20 w-[350px] h-[350px] rounded-full bg-purple-400/12 dark:bg-white/[0.05]" style={{ animation: 'circleLeftSlow 26s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] h-[500px] rounded-full bg-indigo-400/[0.14] dark:bg-white/[0.06] blur-[80px]" style={{ animation: 'circleRight 34s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="relative z-30 flex items-center justify-between mb-5">
        <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('Разделы', 'Sections')}</h1>
        <SettingsMenu />
      </div>

      <div className="relative z-10 grid grid-cols-2 gap-2.5">
        {items.map(({ to, label, icon: Icon, color }, i) => (
          <motion.div
            key={to}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.03, duration: 0.2 }}
          >
            <NavLink
              to={to}
              className="flex items-center gap-3 p-3.5 bg-white dark:bg-gray-800/80 rounded-2xl border border-gray-100 dark:border-gray-700/50 active:scale-[0.97] transition-all"
            >
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center shadow-sm flex-shrink-0`}>
                <Icon size={18} className="text-white" strokeWidth={2} />
              </div>
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{label}</span>
            </NavLink>
          </motion.div>
        ))}
      </div>

      {/* User card */}
      <NavLink to="/profile" className="relative z-10 mt-6 p-4 bg-white dark:bg-gray-800/80 rounded-2xl border border-gray-100 dark:border-gray-700/50 block active:scale-[0.98] transition-all">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white font-bold flex-shrink-0">
            {(user?.name || user?.email || '?')[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{user?.name}</div>
            <div className="text-xs text-gray-400 truncate">{user?.email}</div>
          </div>
          {user?.role === 'admin' && (
            <a
              href="/admin.html"
              target="_blank"
              rel="noopener"
              onClick={(e) => { e.stopPropagation(); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
            >
              <Shield size={14} />
              {t('Админка', 'Admin')}
            </a>
          )}
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); logout(); window.location.href = '/login'; }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <LogOut size={14} />
            {t('Выйти', 'Sign out')}
          </button>
        </div>
      </NavLink>
    </div>
  );
}
