import { Router, Request, Response } from 'express';
import { getDb } from '../db/db';

export const exportRouter = Router();

exportRouter.get('/tasks.csv', (_req: Request, res: Response) => {
  const tasks = getDb()
    .prepare(
      "SELECT id, title, status, priority, due_date, project_id, created_at FROM tasks WHERE archived = 0"
    )
    .all() as Array<Record<string, unknown>>;
  const projects = getDb()
    .prepare("SELECT id, name FROM projects")
    .all() as Array<{ id: number; name: string }>;
  const pMap = new Map(projects.map((p) => [p.id, p.name]));

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=tasks.csv');

  let csv = '\uFEFF'; // BOM for Excel
  csv += 'ID,Название,Статус,Приоритет,Дедлайн,Проект,Создано\n';
  for (const t of tasks) {
    csv += `${t.id},"${(String(t.title || '')).replace(/"/g, '""')}",${t.status},${t.priority},${t.due_date || ''},${pMap.get(t.project_id as number) || ''},${t.created_at}\n`;
  }
  res.send(csv);
});

exportRouter.get('/meetings.csv', (_req: Request, res: Response) => {
  const meetings = getDb()
    .prepare(
      "SELECT id, title, date, summary_raw, created_at FROM meetings"
    )
    .all() as Array<Record<string, unknown>>;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=meetings.csv');

  let csv = '\uFEFF'; // BOM for Excel
  csv += 'ID,Название,Дата,Резюме,Создано\n';
  for (const m of meetings) {
    const summary = String(m.summary_raw || '').replace(/"/g, '""').replace(/\n/g, ' ');
    csv += `${m.id},"${(String(m.title || '')).replace(/"/g, '""')}",${m.date || ''},"${summary}",${m.created_at}\n`;
  }
  res.send(csv);
});
