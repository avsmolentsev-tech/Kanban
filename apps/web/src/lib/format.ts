/** Strip markdown-link syntax from imported titles: "[text](url)" → "text". */
export function cleanTaskTitle(title: string | null | undefined): string {
  if (!title) return '';
  return title
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1') // [text](url) → text
    .replace(/\s+/g, ' ')
    .trim();
}

/** Priority (1-5) → a compact colored pill descriptor. Higher value = higher priority. */
export function priorityPill(priority: number): { label: string; cls: string } | null {
  if (priority >= 4) return { label: 'Высокий', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' };
  if (priority === 3) return { label: 'Средний', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' };
  if (priority <= 2 && priority >= 1) return { label: 'Низкий', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' };
  return null;
}
