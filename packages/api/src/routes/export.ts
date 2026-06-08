import { Router, Response } from 'express';
import { queryAll } from '../db/db';
import type { AuthRequest } from '../middleware/auth';
import { getUserId } from '../middleware/user-scope';

export const exportRouter = Router();

exportRouter.get('/tasks.csv', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  const userFilter = userId != null ? ' AND user_id = $1' : '';
  const userParams = userId != null ? [userId] : [];

  const tasks = await queryAll<Record<string, unknown>>(
    `SELECT id, title, status, priority, due_date, project_id, created_at FROM tasks WHERE archived = 0${userFilter}`,
    userParams
  );
  const projects = await queryAll<{ id: number; name: string }>(
    `SELECT id, name FROM projects WHERE 1=1${userFilter}`,
    userParams
  );
  const pMap = new Map(projects.map((p) => [p.id, p.name]));

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=tasks.csv');

  let csv = '\uFEFF'; // BOM for Excel
  csv += 'ID,Название,Статус,Приоритет,Дедлайн,Проект,Создано\n';
  for (const t of tasks) {
    csv += `${t['id']},"${(String(t['title'] || '')).replace(/"/g, '""')}",${t['status']},${t['priority']},${t['due_date'] || ''},${pMap.get(t['project_id'] as number) || ''},${t['created_at']}\n`;
  }
  res.send(csv);
});

exportRouter.get('/meetings.csv', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  const userFilter = userId != null ? ' AND user_id = $1' : '';
  const userParams = userId != null ? [userId] : [];

  const meetings = await queryAll<Record<string, unknown>>(
    `SELECT id, title, date, summary_raw, created_at FROM meetings WHERE 1=1${userFilter}`,
    userParams
  );

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=meetings.csv');

  let csv = '\uFEFF'; // BOM for Excel
  csv += 'ID,Название,Дата,Резюме,Создано\n';
  for (const m of meetings) {
    const summary = String(m['summary_raw'] || '').replace(/"/g, '""').replace(/\n/g, ' ');
    csv += `${m['id']},"${(String(m['title'] || '')).replace(/"/g, '""')}",${m['date'] || ''},"${summary}",${m['created_at']}\n`;
  }
  res.send(csv);
});
