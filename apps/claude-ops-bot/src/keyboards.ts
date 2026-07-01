import { Markup } from 'telegraf';
import type { Target } from './project-resolver.js';

export function projectKeyboard(projects: Target[]) {
  const buttons = projects.map((p) =>
    Markup.button.callback(`${p.type === 'git' ? '📦' : '📁'} ${p.name}`, `select_project:${p.name}`)
  );
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  // Add utility buttons at the bottom
  rows.push([Markup.button.callback('\u2795 \u041d\u043e\u0432\u044b\u0439 \u043f\u0440\u043e\u0435\u043a\u0442', 'new_project_flow')]);
  return Markup.inlineKeyboard(rows);
}

export function targetKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🇱🇻 Сервер (Рига)', 'target:server'),
     Markup.button.callback('💻 Мой комп', 'target:desktop')],
  ]);
}

export function modelKeyboard(current: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(current === 'sonnet' ? '● Sonnet' : '○ Sonnet', 'model:sonnet'),
     Markup.button.callback(current === 'opus' ? '● Opus' : '○ Opus', 'model:opus')],
  ]);
}

export function planGateKeyboard(taskId: number) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Approve', `plan:approve:${taskId}`),
     Markup.button.callback('✏️ Уточнить', `plan:edit:${taskId}`),
     Markup.button.callback('❌ Отмена', `plan:cancel:${taskId}`)],
  ]);
}

export function questionKeyboard(taskId: number, options: string[]) {
  const buttons = options.map((opt, i) => Markup.button.callback(opt, `answer:${taskId}:${i}`));
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  return Markup.inlineKeyboard(rows);
}

export function doneKeyboard(taskId: number, miniappUrl: string) {
  return Markup.inlineKeyboard([
    [Markup.button.webApp('📋 Diff', `${miniappUrl}/task/${taskId}/diff`),
     Markup.button.callback('✅ Push', `action:push:${taskId}`)],
    [Markup.button.callback('↩ Откат', `action:rollback:${taskId}`),
     Markup.button.callback('💬 Продолжить', `action:continue:${taskId}`)],
  ]);
}

export function failedKeyboard(taskId: number) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔄 Retry', `action:retry:${taskId}`),
     Markup.button.callback('❌ Отмена', `action:cancel:${taskId}`)],
  ]);
}

export function workingKeyboard(taskId: number) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⏹ Стоп', `action:stop:${taskId}`)],
  ]);
}

export function activeTasksKeyboard(tasks: Array<{ id: number; project_name: string; state: string }>) {
  const stateEmoji: Record<string, string> = {
    CREATED: '🆕', PLANNING: '🧠', PLAN_GATE: '🧭', RUNNING: '🚀', VERIFYING: '🧪', DONE: '✅', FAILED: '❌', REJECTED: '🚫',
  };
  const buttons = tasks.map((t) =>
    Markup.button.callback(`${stateEmoji[t.state] ?? '❓'} #${t.id} ${t.project_name}`, `task:view:${t.id}`)
  );
  return Markup.inlineKeyboard(buttons.map(b => [b]));
}
