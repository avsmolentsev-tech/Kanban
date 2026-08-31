import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ObsidianService } from '../services/obsidian.service';

const tmpVault = path.join(os.tmpdir(), 'vault-test-' + Date.now());

afterAll(() => fs.rmSync(tmpVault, { recursive: true, force: true }));

function read(relPath: string): string {
  return fs.readFileSync(path.join(tmpVault, relPath), 'utf-8');
}

test('writeMeeting includes company wiki-link and tags when set', async () => {
  const svc = new ObsidianService(tmpVault).forUser(2);
  const rel = await svc.writeMeeting({
    title: 'Обсуждение прототипа',
    date: '2026-04-16',
    project: 'Роботы-мойщики',
    company: 'Keenon Robotics',
    people: ['Максим'],
    summary: 'Summary',
    tags: ['type/meeting', 'project/roboty-mojshiki', 'company/keenon-robotics', 'прототип'],
    source: 'telegram-voice',
    agreements: 1,
  });
  const body = read(rel);
  expect(body).toMatch(/company:\s*\[\[Keenon Robotics\]\]/);
  expect(body).toMatch(/project:\s*\[\[Роботы-мойщики\]\]/);
  expect(body).toMatch(/source:\s*telegram-voice/);
  expect(body).toMatch(/^\*\*Компания:\*\* \[\[Keenon Robotics\]\]/m);
  expect(body).toMatch(/tags:\s*\[type\/meeting,\s*project\/roboty-mojshiki,\s*company\/keenon-robotics,\s*прототип\]/);
});

test('writeMeeting omits company block when company not set', async () => {
  const svc = new ObsidianService(tmpVault).forUser(2);
  const rel = await svc.writeMeeting({
    title: 'No company meeting',
    date: '2026-04-16',
    people: [],
    summary: 'x',
    tags: ['type/meeting'],
    source: 'telegram-text',
  });
  const body = read(rel);
  expect(body).toMatch(/company:\s*null/);
  expect(body).not.toMatch(/\*\*Компания:\*\*/);
});

test('writeTask and writeIdea accept company and include it in frontmatter', async () => {
  const svc = new ObsidianService(tmpVault).forUser(2);
  const relTask = await svc.writeTask({
    title: 'Подготовить TZ',
    status: 'todo',
    priority: 3,
    urgency: 3,
    project: 'Роботы-мойщики',
    company: 'Keenon Robotics',
    people: [],
    tags: ['type/task', 'project/roboty-mojshiki', 'company/keenon-robotics'],
    source: 'telegram-text',
  });
  expect(read(relTask)).toMatch(/company:\s*\[\[Keenon Robotics\]\]/);
  const relIdea = await svc.writeIdea({
    title: 'Новая фича',
    body: 'Описание',
    category: 'product',
    company: 'Keenon Robotics',
    tags: ['type/idea', 'category/product', 'company/keenon-robotics'],
    source: 'telegram-text',
    date: '2026-04-16',
  });
  expect(read(relIdea)).toMatch(/company:\s*\[\[Keenon Robotics\]\]/);
});
