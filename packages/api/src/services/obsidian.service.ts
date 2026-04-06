import * as fs from 'fs';
import * as path from 'path';
import slugify from 'slugify';

interface WriteTaskParams {
  title: string;
  status: string;
  priority: number;
  urgency: number;
  project?: string;
  due_date?: string | null;
  people?: string[];
  tags?: string[];
}

interface WriteMeetingParams {
  title: string;
  date: string;
  project?: string;
  people?: string[];
  summary: string;
  agreements?: number;
  source?: string;
}

interface WritePersonParams {
  name: string;
  company?: string;
  role?: string;
  tags?: string[];
}

interface WriteIdeaParams {
  title: string;
  body: string;
  category: string;
  project?: string;
  source?: string;
  date: string;
}

export class ObsidianService {
  constructor(private readonly vaultPath: string) {}

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  private toSlug(text: string): string {
    return slugify(text, { lower: true, strict: true, locale: 'ru' });
  }

  private wikiLink(name: string): string {
    return `[[${name}]]`;
  }

  private now(): string {
    return new Date().toISOString();
  }

  meetingFileName(date: string, title: string): string {
    return `${date}-${this.toSlug(title)}.md`;
  }

  async writeTask(params: WriteTaskParams): Promise<string> {
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
    const filename = `task-${ts}-${this.toSlug(params.title)}.md`;
    const dir = path.join(this.vaultPath, 'Tasks');
    this.ensureDir(dir);
    const people = (params.people ?? []).map((p) => this.wikiLink(p));
    const frontmatter = [
      '---', 'type: task', `status: ${params.status}`,
      `project: ${params.project ? this.wikiLink(params.project) : 'null'}`,
      `priority: ${params.priority}`, `urgency: ${params.urgency}`,
      `due_date: ${params.due_date ?? 'null'}`,
      `people: [${people.join(', ')}]`,
      `tags: [${(params.tags ?? ['task']).join(', ')}]`,
      `created_at: ${this.now()}`, '---',
    ].join('\n');
    fs.writeFileSync(path.join(dir, filename), `${frontmatter}\n\n# ${params.title}\n\n`, 'utf-8');
    return `Tasks/${filename}`;
  }

  async writeMeeting(params: WriteMeetingParams): Promise<string> {
    const filename = this.meetingFileName(params.date, params.title);
    const dir = path.join(this.vaultPath, 'Meetings');
    this.ensureDir(dir);
    const people = (params.people ?? []).map((p) => this.wikiLink(p));
    const frontmatter = [
      '---', 'type: meeting', `date: ${params.date}`, `title: "${params.title}"`,
      `project: ${params.project ? this.wikiLink(params.project) : 'null'}`,
      `people: [${people.join(', ')}]`, `agreements: ${params.agreements ?? 0}`,
      'tags: [meeting]', `source: ${params.source ?? 'manual'}`,
      `created_at: ${this.now()}`, '---',
    ].join('\n');
    fs.writeFileSync(path.join(dir, filename), `${frontmatter}\n\n# ${params.title}\n\n${params.summary}\n`, 'utf-8');
    return `Meetings/${filename}`;
  }

  async writePerson(params: WritePersonParams): Promise<string> {
    const filename = `${this.toSlug(params.name)}.md`;
    const dir = path.join(this.vaultPath, 'People');
    this.ensureDir(dir);
    const frontmatter = [
      '---', 'type: person', `name: "${params.name}"`,
      `company: "${params.company ?? ''}"`, `role: "${params.role ?? ''}"`,
      `tags: [${(params.tags ?? ['person']).join(', ')}]`,
      `created_at: ${this.now()}`, '---',
    ].join('\n');
    fs.writeFileSync(path.join(dir, filename), `${frontmatter}\n\n# ${params.name}\n\n`, 'utf-8');
    return `People/${filename}`;
  }

  async writeIdea(params: WriteIdeaParams): Promise<string> {
    const filename = `${params.date}-idea-${this.toSlug(params.title)}.md`;
    const dir = path.join(this.vaultPath, 'Ideas');
    this.ensureDir(dir);
    const frontmatter = [
      '---', 'type: idea', `category: ${params.category}`,
      `project: ${params.project ? this.wikiLink(params.project) : 'null'}`,
      `source: ${params.source ?? 'manual'}`, 'tags: [idea]',
      `created_at: ${this.now()}`, '---',
    ].join('\n');
    fs.writeFileSync(path.join(dir, filename), `${frontmatter}\n\n# ${params.title}\n\n${params.body}\n`, 'utf-8');
    return `Ideas/${filename}`;
  }

  async writeInboxItem(originalName: string, content: string): Promise<string> {
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
    const filename = `inbox-${ts}-${this.toSlug(originalName)}.md`;
    const dir = path.join(this.vaultPath, 'Inbox');
    this.ensureDir(dir);
    fs.writeFileSync(path.join(dir, filename), content, 'utf-8');
    return `Inbox/${filename}`;
  }

  readFile(relativePath: string): string {
    return fs.readFileSync(path.join(this.vaultPath, relativePath), 'utf-8');
  }

  listFolder(folder: string): string[] {
    const dir = path.join(this.vaultPath, folder);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => `${folder}/${f}`);
  }

  initVaultFolders(): void {
    for (const folder of ['Projects', 'People', 'Meetings', 'Ideas', 'Goals', 'Tasks', 'Materials', 'Inbox']) {
      this.ensureDir(path.join(this.vaultPath, folder));
    }
  }
}
