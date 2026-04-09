import * as fs from 'fs';
import * as path from 'path';
import { getDb } from '../db/db';
import { config } from '../config';
import { moscowDateString } from '../utils/time';

interface Meeting { id: number; title: string; date: string; summary_raw: string; project_id: number | null }
interface Task { id: number; title: string; description: string; status: string; priority: number; due_date: string | null; project_id: number | null }
interface Idea { id: number; title: string; body: string; status: string; project_id: number | null }
interface Document { id: number; title: string; body: string; project_id: number | null }
interface Person { id: number; name: string; company: string; role: string; notes: string }

export interface BundleResult {
  vaultPath: string;
  filename: string;
  sizeKb: number;
  sections: Record<string, number>;
}

/** Generate a NotebookLM-ready bundle markdown for a specific project, or all projects */
export function generateBundle(projectIdOrAll: number | 'all'): BundleResult {
  const db = getDb();
  const bundleDate = moscowDateString();

  let projects: Array<{ id: number; name: string; description: string }>;
  let projectLabel: string;
  let filenameSuffix: string;

  if (projectIdOrAll === 'all') {
    projects = db.prepare('SELECT id, name, description FROM projects WHERE archived = 0 ORDER BY order_index').all() as Array<{ id: number; name: string; description: string }>;
    projectLabel = 'Все проекты';
    filenameSuffix = 'all-projects';
  } else {
    const proj = db.prepare('SELECT id, name, description FROM projects WHERE id = ?').get(projectIdOrAll) as { id: number; name: string; description: string } | undefined;
    if (!proj) throw new Error(`Проект #${projectIdOrAll} не найден`);
    projects = [proj];
    projectLabel = proj.name;
    filenameSuffix = proj.name.toLowerCase().replace(/[^а-яa-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  }

  const projectIds = projects.map(p => p.id);
  const idsPlaceholders = projectIds.map(() => '?').join(',');

  // Fetch all related data
  const meetings = projectIds.length > 0
    ? db.prepare(`SELECT m.id, m.title, m.date, m.summary_raw, m.project_id FROM meetings m LEFT JOIN meeting_projects mp ON mp.meeting_id = m.id WHERE m.project_id IN (${idsPlaceholders}) OR mp.project_id IN (${idsPlaceholders}) GROUP BY m.id ORDER BY m.date DESC`).all(...projectIds, ...projectIds) as Meeting[]
    : [];

  const tasks = projectIds.length > 0
    ? db.prepare(`SELECT id, title, description, status, priority, due_date, project_id FROM tasks WHERE project_id IN (${idsPlaceholders}) AND archived = 0 ORDER BY priority DESC, due_date ASC`).all(...projectIds) as Task[]
    : [];

  const ideas = projectIds.length > 0
    ? db.prepare(`SELECT id, title, body, status, project_id FROM ideas WHERE project_id IN (${idsPlaceholders}) AND archived = 0 ORDER BY created_at DESC`).all(...projectIds) as Idea[]
    : [];

  let documents: Document[] = [];
  try {
    documents = projectIds.length > 0
      ? db.prepare(`SELECT id, title, body, project_id FROM documents WHERE project_id IN (${idsPlaceholders}) ORDER BY created_at DESC`).all(...projectIds) as Document[]
      : [];
  } catch {}

  const people = projectIds.length > 0
    ? db.prepare(`SELECT DISTINCT p.id, p.name, p.company, p.role, p.notes FROM people p JOIN people_projects pp ON pp.person_id = p.id WHERE pp.project_id IN (${idsPlaceholders})`).all(...projectIds) as Person[]
    : [];

  // Build markdown
  const lines: string[] = [];
  lines.push(`# ${projectLabel} — Bundle для NotebookLM`);
  lines.push('');
  lines.push(`**Дата создания:** ${bundleDate}`);
  lines.push(`**Проекты:** ${projects.map(p => p.name).join(', ')}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Projects overview
  lines.push('## Обзор проектов');
  lines.push('');
  for (const p of projects) {
    lines.push(`### ${p.name}`);
    if (p.description) lines.push(p.description);
    lines.push('');
  }
  lines.push('---');
  lines.push('');

  // People
  if (people.length > 0) {
    lines.push('## Участники');
    lines.push('');
    for (const p of people) {
      lines.push(`- **${p.name}**${p.role ? ` — ${p.role}` : ''}${p.company ? ` @ ${p.company}` : ''}`);
      if (p.notes) lines.push(`  ${p.notes}`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // Meetings with full transcripts
  if (meetings.length > 0) {
    lines.push(`## Встречи (${meetings.length})`);
    lines.push('');
    for (const m of meetings) {
      lines.push(`### ${m.date} — ${m.title}`);
      lines.push('');
      if (m.summary_raw) {
        lines.push(m.summary_raw);
      }
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  // Tasks
  if (tasks.length > 0) {
    lines.push(`## Задачи (${tasks.length})`);
    lines.push('');
    const byStatus = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!byStatus.has(t.status)) byStatus.set(t.status, []);
      byStatus.get(t.status)!.push(t);
    }
    const statusLabels: Record<string, string> = {
      backlog: 'Backlog', todo: 'К выполнению', in_progress: 'В работе', done: 'Выполнено', someday: 'Когда-нибудь',
    };
    for (const [status, taskList] of byStatus.entries()) {
      lines.push(`### ${statusLabels[status] ?? status}`);
      for (const t of taskList) {
        lines.push(`- ${t.title}${t.due_date ? ` (срок: ${t.due_date})` : ''} ${'⭐'.repeat(t.priority)}`);
        if (t.description) lines.push(`  ${t.description}`);
      }
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  // Ideas
  if (ideas.length > 0) {
    lines.push(`## Идеи (${ideas.length})`);
    lines.push('');
    for (const i of ideas) {
      lines.push(`### ${i.title}`);
      if (i.body) lines.push(i.body);
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  // Documents
  if (documents.length > 0) {
    lines.push(`## Документы (${documents.length})`);
    lines.push('');
    for (const d of documents) {
      lines.push(`### ${d.title}`);
      if (d.body) lines.push(d.body);
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  const content = lines.join('\n');

  // Save to vault
  const bundleDir = path.join(config.vaultPath, 'NotebookLM-Bundles');
  if (!fs.existsSync(bundleDir)) fs.mkdirSync(bundleDir, { recursive: true });

  const filename = `${bundleDate}-${filenameSuffix}.md`;
  const filepath = path.join(bundleDir, filename);
  fs.writeFileSync(filepath, content, 'utf-8');

  const vaultPath = `NotebookLM-Bundles/${filename}`;
  const stats = fs.statSync(filepath);

  return {
    vaultPath,
    filename,
    sizeKb: Math.round(stats.size / 1024),
    sections: {
      meetings: meetings.length,
      tasks: tasks.length,
      ideas: ideas.length,
      documents: documents.length,
      people: people.length,
    },
  };
}

/** Fuzzy find project by name */
export function findProjectByName(query: string): number | 'all' | null {
  const lower = query.toLowerCase().trim();
  if (['все', 'all', 'всё'].includes(lower)) return 'all';
  const projects = getDb().prepare('SELECT id, name FROM projects WHERE archived = 0').all() as Array<{ id: number; name: string }>;
  for (const p of projects) {
    if (p.name.toLowerCase() === lower) return p.id;
  }
  for (const p of projects) {
    if (p.name.toLowerCase().includes(lower) || lower.includes(p.name.toLowerCase())) return p.id;
  }
  return null;
}
