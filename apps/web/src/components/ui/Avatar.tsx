import { useState } from 'react';

interface AvatarProps { name: string; size?: 'sm' | 'md'; url?: string | null }

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map((n) => n[0]?.toUpperCase() ?? '').join('');
}

export function Avatar({ name, size = 'sm', url }: AvatarProps) {
  const [err, setErr] = useState(false);
  const dim = size === 'sm' ? 'w-6 h-6' : 'w-8 h-8';
  if (url && !err) {
    return (
      <img
        src={url}
        alt={name}
        title={name}
        onError={() => setErr(true)}
        className={`${dim} rounded-full object-cover bg-gray-200 dark:bg-gray-700 flex-shrink-0`}
      />
    );
  }
  return (
    <div className={`${dim} ${size === 'sm' ? 'text-xs' : 'text-sm'} rounded-full bg-indigo-500 text-white flex items-center justify-center font-medium flex-shrink-0`} title={name}>
      {initials(name)}
    </div>
  );
}
