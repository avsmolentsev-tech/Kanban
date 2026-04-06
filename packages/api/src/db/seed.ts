import { getDb } from './db';

export function seedDb(): void {
  const db = getDb();

  const projectCount = (db.prepare('SELECT COUNT(*) as c FROM projects').get() as { c: number }).c;
  if (projectCount > 0) return;

  const insertProject = db.prepare(
    'INSERT INTO projects (name, description, status, color) VALUES (?, ?, ?, ?)'
  );
  const p1 = insertProject.run('Личные цели 2026', 'Цели на год', 'active', '#6366f1');
  const p2 = insertProject.run('Рабочие проекты', 'Текущие рабочие задачи', 'active', '#10b981');
  const p3 = insertProject.run('Обучение', 'Курсы, книги, материалы', 'active', '#f59e0b');

  const insertTask = db.prepare(
    'INSERT INTO tasks (project_id, title, status, priority, urgency) VALUES (?, ?, ?, ?, ?)'
  );
  insertTask.run(p1.lastInsertRowid, 'Настроить PIS систему', 'in_progress', 5, 5);
  insertTask.run(p1.lastInsertRowid, 'Прочитать 12 книг за год', 'todo', 3, 2);
  insertTask.run(p2.lastInsertRowid, 'Провести ревью кода', 'todo', 4, 3);
  insertTask.run(p2.lastInsertRowid, 'Написать документацию', 'backlog', 2, 1);
  insertTask.run(p3.lastInsertRowid, 'Пройти курс по TypeScript', 'todo', 3, 2);

  const insertPerson = db.prepare(
    'INSERT INTO people (name, company, role) VALUES (?, ?, ?)'
  );
  insertPerson.run('Иван Петров', 'ООО Рога и Копыта', 'Директор');
  insertPerson.run('Мария Сидорова', 'Freelance', 'Дизайнер');

  console.log('[seed] database seeded with sample data');
}
