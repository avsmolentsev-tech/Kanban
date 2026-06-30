import type { TaskRow } from './db.js';

export interface DiffFile {
  path: string;
  added: number;
  removed: number;
}

export function formatReport(task: TaskRow): string {
  const duration = task.duration_ms
    ? task.duration_ms > 60000
      ? `${Math.floor(task.duration_ms / 60000)}м ${Math.round((task.duration_ms % 60000) / 1000)}с`
      : `${Math.round(task.duration_ms / 1000)}с`
    : '?';

  const lines: string[] = [];
  lines.push(`✅ Задача #${task.id} · ${task.project_name} · ${duration}`);
  lines.push('');

  if (task.result_summary) {
    lines.push('📝 Что сделал:');
    lines.push(task.result_summary);
    lines.push('');
  }

  if (task.diff_stat) {
    const files: DiffFile[] = JSON.parse(task.diff_stat);
    lines.push(`📁 Файлы (${files.length}):`);
    for (const f of files) {
      lines.push(`  +${f.added} -${f.removed}  ${f.path}`);
    }
    lines.push('');
  }

  if (task.test_result) {
    lines.push(task.test_result);
  }

  return lines.join('\n');
}

export function formatFailed(task: TaskRow): string {
  const lines: string[] = [];
  lines.push(`❌ Задача #${task.id} · ${task.project_name}`);
  lines.push('');
  if (task.test_result) {
    lines.push('🧪 Результат:');
    lines.push(task.test_result);
  }
  if (task.result_summary) {
    lines.push('');
    lines.push(task.result_summary);
  }
  return lines.join('\n');
}

export function formatPlan(taskId: number, projectName: string, plan: string): string {
  const lines: string[] = [];
  lines.push(`🧭 Задача #${taskId} · ${projectName}`);
  lines.push('');
  lines.push('📋 План:');
  lines.push(plan);
  return lines.join('\n');
}
