import { queryOne, execute } from './db';

export async function seedDb(): Promise<void> {
  const projectCount = await queryOne<{ c: string }>('SELECT COUNT(*) as c FROM projects', []);
  if (projectCount && Number(projectCount.c) > 0) return;

  const p1 = await queryOne<{ id: number }>(
    "INSERT INTO projects (name, description, status, color) VALUES ($1, $2, $3, $4) RETURNING id",
    ['Личные цели 2026', 'Цели на год', 'active', '#6366f1']
  );
  const p2 = await queryOne<{ id: number }>(
    "INSERT INTO projects (name, description, status, color) VALUES ($1, $2, $3, $4) RETURNING id",
    ['Рабочие проекты', 'Текущие рабочие задачи', 'active', '#10b981']
  );
  const p3 = await queryOne<{ id: number }>(
    "INSERT INTO projects (name, description, status, color) VALUES ($1, $2, $3, $4) RETURNING id",
    ['Обучение', 'Курсы, книги, материалы', 'active', '#f59e0b']
  );

  await execute('INSERT INTO tasks (project_id, title, status, priority, urgency) VALUES ($1, $2, $3, $4, $5)', [p1!.id, 'Настроить PIS систему', 'in_progress', 5, 5]);
  await execute('INSERT INTO tasks (project_id, title, status, priority, urgency) VALUES ($1, $2, $3, $4, $5)', [p1!.id, 'Прочитать 12 книг за год', 'todo', 3, 2]);
  await execute('INSERT INTO tasks (project_id, title, status, priority, urgency) VALUES ($1, $2, $3, $4, $5)', [p2!.id, 'Провести ревью кода', 'todo', 4, 3]);
  await execute('INSERT INTO tasks (project_id, title, status, priority, urgency) VALUES ($1, $2, $3, $4, $5)', [p2!.id, 'Написать документацию', 'backlog', 2, 1]);
  await execute('INSERT INTO tasks (project_id, title, status, priority, urgency) VALUES ($1, $2, $3, $4, $5)', [p3!.id, 'Пройти курс по TypeScript', 'todo', 3, 2]);

  await execute('INSERT INTO people (name, company, role) VALUES ($1, $2, $3)', ['Иван Петров', 'ООО Рога и Копыта', 'Директор']);
  await execute('INSERT INTO people (name, company, role) VALUES ($1, $2, $3)', ['Мария Сидорова', 'Freelance', 'Дизайнер']);

  console.log('[seed] database seeded with sample data');
}
