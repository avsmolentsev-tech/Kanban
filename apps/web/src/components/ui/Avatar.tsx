import { useState } from 'react';

interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  url?: string | null;
  onClick?: () => void;
}

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map((n) => n[0]?.toUpperCase() ?? '').join('');
}

const DIMS: Record<string, string> = {
  sm: 'w-6 h-6 text-xs',
  md: 'w-8 h-8 text-sm',
  lg: 'w-16 h-16 text-xl',
  xl: 'w-24 h-24 text-3xl',
};

export function Avatar({ name, size = 'sm', url, onClick }: AvatarProps) {
  const [err, setErr] = useState(false);
  const dim = DIMS[size] ?? DIMS['sm']!;
  const wh = dim.split(' ').slice(0, 2).join(' ');
  const clickable = onClick ? 'cursor-pointer hover:opacity-90 transition-opacity' : '';
  if (url && !err) {
    return (
      <img
        src={url}
        alt={name}
        title={name}
        onClick={onClick}
        onError={() => setErr(true)}
        className={`${wh} rounded-full object-cover bg-gray-200 dark:bg-gray-700 flex-shrink-0 ${clickable}`}
      />
    );
  }
  return (
    <div
      onClick={onClick}
      className={`${dim} rounded-full bg-indigo-500 text-white flex items-center justify-center font-medium flex-shrink-0 ${clickable}`}
      title={name}
    >
      {initials(name)}
    </div>
  );
}
