import type { DraftCard, DraftType } from '@pis/shared';

export type DraftAction = 'ok' | 'fix' | 'cancel' | 'as-meeting' | 'as-task' | 'as-idea';

export function encodeCallbackData(draftId: string, action: DraftAction): string {
  return `draft:${draftId}:${action}`;
}

export function parseCallbackData(s: string): { draftId: string; action: DraftAction } | null {
  const m = /^draft:([^:]+):(ok|fix|cancel|as-meeting|as-task|as-idea)$/.exec(s);
  if (!m) return null;
  return { draftId: m[1]!, action: m[2] as DraftAction };
}

const TYPE_RU: Record<DraftType, string> = {
  meeting: 'встреча',
  task: 'задача',
  idea: 'идея',
  inbox: 'заметка',
};

export function renderDraftCard(c: DraftCard): string {
  const lines: string[] = [
    '📝 Расшифровано.',
    '',
    `Тип: ${TYPE_RU[c.type]}`,
    `Название: ${c.title}`,
    `Дата: ${c.date}`,
  ];
  if (c.projectName) lines.push(`Проект: ${c.projectName}`);
  if (c.companyName) lines.push(`Компания: ${c.companyName}`);
  if (c.people.length > 0) lines.push(`Люди: ${c.people.join(', ')}`);
  if (c.tags.length > 0) lines.push(`Теги: ${c.tags.map((t) => '#' + t).join(', ')}`);
  return lines.join('\n');
}

export function inlineKeyboard(c: DraftCard): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  return {
    inline_keyboard: [
      [
        { text: '✅ OK', callback_data: encodeCallbackData(c.id, 'ok') },
        { text: '✏️ Исправить', callback_data: encodeCallbackData(c.id, 'fix') },
        { text: '❌ Отменить', callback_data: encodeCallbackData(c.id, 'cancel') },
      ],
      [
        { text: '🤝 Это встреча', callback_data: encodeCallbackData(c.id, 'as-meeting') },
        { text: '📋 Это задача', callback_data: encodeCallbackData(c.id, 'as-task') },
        { text: '💡 Это идея', callback_data: encodeCallbackData(c.id, 'as-idea') },
      ],
    ],
  };
}
