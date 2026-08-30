import * as fs from 'fs';
import * as path from 'path';
import { queryAll, queryOne } from '../db/db';
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

/** Generate a NotebookLM-ready bundle markdown for a specific project, or all projects.
 *  brief=true omits full meeting transcripts — only title, date, and 1-line TL;DR. */
export async function generateBundle(projectIdOrAll: number | 'all', brief = false): Promise<BundleResult> {
  const bundleDate = moscowDateString();

  let projects: Array<{ id: number; name: string; description: string }>;
  let projectLabel: string;
  let filenameSuffix: string;

  if (projectIdOrAll === 'all') {
    projects = await queryAll<{ id: number; name: string; description: string }>(
      'SELECT id, name, description FROM projects WHERE archived = 0 ORDER BY order_index'
    );
    projectLabel = 'Все проекты';
    filenameSuffix = 'all-projects';
  } else {
    const proj = await queryOne<{ id: number; name: string; description: string }>(
      'SELECT id, name, description FROM projects WHERE id = $1',
      [projectIdOrAll]
    );
    if (!proj) throw new Error(`Проект #${projectIdOrAll} не найден`);
    projects = [proj];
    projectLabel = proj.name;
    filenameSuffix = proj.name.toLowerCase().replace(/[^а-яa-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  }

  const projectIds = projects.map(p => p.id);

  // Build $1, $2, ... placeholders
  const makePlaceholders = (count: number, offset = 0) =>
    Array.from({ length: count }, (_, i) => `$${i + offset + 1}`).join(', ');

  // Fetch all related data
  let meetings: Array<Meeting & { summary_structured: string | null }> = [];
  let tasks: Task[] = [];
  let ideas: Idea[] = [];
  let documents: Document[] = [];
  let people: Person[] = [];

  if (projectIds.length > 0) {
    const ph = makePlaceholders(projectIds.length);
    const ph2 = makePlaceholders(projectIds.length, projectIds.length);

    meetings = await queryAll<Meeting & { summary_structured: string | null }>(
      `SELECT m.id, m.title, m.date, m.summary_raw, m.summary_structured, m.project_id
       FROM meetings m
       LEFT JOIN meeting_projects mp ON mp.meeting_id = m.id
       WHERE m.project_id IN (${ph}) OR mp.project_id IN (${ph2})
       GROUP BY m.id
       ORDER BY m.date DESC`,
      [...projectIds, ...projectIds]
    );

    tasks = await queryAll<Task>(
      `SELECT id, title, description, status, priority, due_date, project_id FROM tasks WHERE project_id IN (${ph}) AND archived = 0 ORDER BY priority DESC, due_date ASC`,
      projectIds
    );

    ideas = await queryAll<Idea>(
      `SELECT id, title, body, status, project_id FROM ideas WHERE project_id IN (${ph}) AND archived = 0 ORDER BY created_at DESC`,
      projectIds
    );

    try {
      documents = await queryAll<Document>(
        `SELECT id, title, body, project_id FROM documents WHERE project_id IN (${ph}) ORDER BY created_at DESC`,
        projectIds
      );
    } catch {}

    people = await queryAll<Person>(
      `SELECT DISTINCT p.id, p.name, p.company, p.role, p.notes FROM people p JOIN people_projects pp ON pp.person_id = p.id WHERE pp.project_id IN (${ph})`,
      projectIds
    );
  }

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

  // Meetings — full transcripts (NotebookLM) or brief TL;DR (weekly digest)
  if (meetings.length > 0) {
    lines.push(`## Встречи (${meetings.length})`);
    lines.push('');
    if (brief) {
      for (const m of meetings) {
        let tldr = '';
        if (m.summary_structured) {
          try { tldr = (JSON.parse(m.summary_structured) as { summary?: string }).summary ?? ''; } catch {}
        }
        lines.push(`- **${m.date}** — ${m.title}${tldr ? `: ${tldr}` : ''}`);
      }
      lines.push('');
      lines.push('---');
      lines.push('');
    } else {
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

  const filename = `${bundleDate}-${filenameSuffix}${brief ? '-brief' : ''}.md`;
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
export async function findProjectByName(query: string): Promise<number | 'all' | null> {
  const lower = query.toLowerCase().trim();
  if (['все', 'all', 'всё'].includes(lower)) return 'all';
  const projects = await queryAll<{ id: number; name: string }>(
    'SELECT id, name FROM projects WHERE archived = 0'
  );
  for (const p of projects) {
    if (p.name.toLowerCase() === lower) return p.id;
  }
  for (const p of projects) {
    if (p.name.toLowerCase().includes(lower) || lower.includes(p.name.toLowerCase())) return p.id;
  }
  return null;
}
