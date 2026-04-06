interface AvatarProps { name: string; size?: 'sm' | 'md'; }

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map((n) => n[0]?.toUpperCase() ?? '').join('');
}

export function Avatar({ name, size = 'sm' }: AvatarProps) {
  const dim = size === 'sm' ? 'w-6 h-6 text-xs' : 'w-8 h-8 text-sm';
  return (
    <div className={`${dim} rounded-full bg-indigo-500 text-white flex items-center justify-center font-medium`} title={name}>
      {initials(name)}
    </div>
  );
}
