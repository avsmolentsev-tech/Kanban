import * as fs from 'fs';
import * as path from 'path';
import slugify from 'slugify';

interface WriteTaskParams {
  title: string;
  status: string;
  priority: number;
  urgency: number;
  project?: string;
  company?: string;
  due_date?: string | null;
  people?: string[];
  tags?: string[];
  source?: string;
}

interface WriteMeetingParams {
  title: string;
  date: string;
  project?: string;
  company?: string;
  people?: string[];
  summary: string;
  agreements?: number;
  tags?: string[];
  source?: string;
}

interface WritePersonParams {
  name: string;
  company?: string;
  role?: string;
  tags?: string[];
  projects?: string[];
  meetings?: Array<{ title: string; date: string; vault_path?: string | null }>;
}

interface WriteProjectParams {
  name: string;
  description?: string;
  status?: string;
  color?: string;
  tags?: string[];
  people?: string[];
  meetings?: Array<{ title: string; date: string; vault_path?: string | null }>;
}

interface WriteIdeaParams {
  title: string;
  body: string;
  category: string;
  project?: string;
  company?: string;
  source?: string;
  tags?: string[];
  date: string;
}

export class ObsidianService {
  constructor(private readonly vaultPath: string, private readonly userPrefix: string = '') {}

  /** Create a user-scoped instance that writes to vault/user_N/ */
  forUser(userId: number | null): ObsidianService {
    if (!userId) return this;
    return new ObsidianService(this.vaultPath, `user_${userId}`);
  }

  /** Resolve path within vault, prefixed with user dir if set */
  private userPath(...parts: string[]): string {
    if (this.userPrefix) {
      return path.join(this.vaultPath, this.userPrefix, ...parts);
    }
    return path.join(this.vaultPath, ...parts);
  }

  /** Return vault-relative path (for storing in DB) */
  private userRelative(...parts: string[]): string {
    if (this.userPrefix) {
      return [this.userPrefix, ...parts].join('/');
    }
    return parts.join('/');
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  private toSlug(text: string): string {
    return slugify(text, { lower: true, strict: true, locale: 'ru' });
  }

  private wikiLink(name: string): string {
    return `[[${name}]]`;
  }

  private wikiOrNull(name: string | undefined | null): string {
    return name ? this.wikiLink(name) : 'null';
  }

  private tagList(tags: string[] | undefined): string {
    const t = (tags && tags.length > 0) ? tags : [];
    return `[${t.join(', ')}]`;
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
    const dir = this.userPath('Tasks');
    this.ensureDir(dir);
    const people = (params.people ?? []).map((p) => this.wikiLink(p));
    const frontmatter = [
      '---', 'type: task', `status: ${params.status}`,
      `project: ${this.wikiOrNull(params.project)}`,
      `company: ${this.wikiOrNull(params.company)}`,
      `priority: ${params.priority}`, `urgency: ${params.urgency}`,
      `due_date: ${params.due_date ?? 'null'}`,
      `people: [${people.join(', ')}]`,
      `tags: ${this.tagList(params.tags)}`,
      `source: ${params.source ?? 'manual'}`,
      `created_at: ${this.now()}`, '---',
    ].join('\n');
    fs.writeFileSync(path.join(dir, filename), `${frontmatter}\n\n# ${params.title}\n\n`, 'utf-8');
    return this.userRelative('Tasks', filename);
  }

  async writeMeeting(params: WriteMeetingParams): Promise<string> {
    const filename = this.meetingFileName(params.date, params.title);
    const dir = this.userPath('Meetings');
    this.ensureDir(dir);
    const people = (params.people ?? []).map((p) => this.wikiLink(p));
    const frontmatter = [
      '---', 'type: meeting', `date: ${params.date}`, `title: "${params.title}"`,
      `project: ${this.wikiOrNull(params.project)}`,
      `company: ${this.wikiOrNull(params.company)}`,
      `people: [${people.join(', ')}]`, `agreements: ${params.agreements ?? 0}`,
      `tags: ${this.tagList(params.tags)}`,
      `source: ${params.source ?? 'manual'}`,
      `created_at: ${this.now()}`, '---',
    ].join('\n');
    const companyLine = params.company ? `**Компания:** ${this.wikiLink(params.company)}\n` : '';
    const projectLine = params.project ? `**Проект:** ${this.wikiLink(params.project)}\n` : '';
    fs.writeFileSync(path.join(dir, filename), `${frontmatter}\n\n# ${params.title}\n\n${companyLine}${projectLine}\n${params.summary}\n`, 'utf-8');
    return this.userRelative('Meetings', filename);
  }

  async writePerson(params: WritePersonParams): Promise<string> {
    const filename = `${this.toSlug(params.name)}.md`;
    const dir = this.userPath('People');
    this.ensureDir(dir);
    const projects = (params.projects ?? []).map((p) => this.wikiLink(p));
    const frontmatter = [
      '---', 'type: person', `name: "${params.name}"`,
      `company: "${params.company ?? ''}"`, `role: "${params.role ?? ''}"`,
      `projects: [${projects.join(', ')}]`,
      `tags: [${(params.tags ?? ['person']).join(', ')}]`,
      `updated_at: ${this.now()}`, '---',
    ].join('\n');
    const meetingsSection = (params.meetings && params.meetings.length > 0)
      ? `## Встречи\n\n${params.meetings.map((m) => `- ${m.date} — ${this.wikiLink(m.title)}`).join('\n')}\n`
      : '';
    const projectsSection = (params.projects && params.projects.length > 0)
      ? `## Проекты\n\n${params.projects.map((p) => `- ${this.wikiLink(p)}`).join('\n')}\n`
      : '';
    const body = `# ${params.name}\n\n${params.role ? `**Роль:** ${params.role}  \n` : ''}${params.company ? `**Компания:** ${params.company}  \n` : ''}\n${projectsSection}\n${meetingsSection}`;
    fs.writeFileSync(path.join(dir, filename), `${frontmatter}\n\n${body}`, 'utf-8');
    return this.userRelative('People', filename);
  }

  async writeProject(params: WriteProjectParams): Promise<string> {
    const filename = `${this.toSlug(params.name)}.md`;
    const dir = this.userPath('Projects');
    this.ensureDir(dir);
    const people = (params.people ?? []).map((p) => this.wikiLink(p));
    const frontmatter = [
      '---', 'type: project', `name: "${params.name}"`,
      `status: ${params.status ?? 'active'}`,
      `color: "${params.color ?? '#6366f1'}"`,
      `people: [${people.join(', ')}]`,
      `tags: [${(params.tags ?? ['project']).join(', ')}]`,
      `updated_at: ${this.now()}`, '---',
    ].join('\n');
    const peopleSection = (params.people && params.people.length > 0)
      ? `## Команда\n\n${params.people.map((p) => `- ${this.wikiLink(p)}`).join('\n')}\n`
      : '';
    const meetingsSection = (params.meetings && params.meetings.length > 0)
      ? `## Встречи\n\n${params.meetings.map((m) => `- ${m.date} — ${this.wikiLink(m.title)}`).join('\n')}\n`
      : '';
    const descSection = params.description ? `\n${params.description}\n` : '';
    const body = `# ${params.name}\n${descSection}\n${peopleSection}\n${meetingsSection}`;
    fs.writeFileSync(path.join(dir, filename), `${frontmatter}\n\n${body}`, 'utf-8');
    return this.userRelative('Projects', filename);
  }

  async writeIdea(params: WriteIdeaParams): Promise<string> {
    const filename = `${params.date}-idea-${this.toSlug(params.title)}.md`;
    const dir = this.userPath('Ideas');
    this.ensureDir(dir);
    const frontmatter = [
      '---', 'type: idea', `category: ${params.category}`,
      `project: ${this.wikiOrNull(params.project)}`,
      `company: ${this.wikiOrNull(params.company)}`,
      `source: ${params.source ?? 'manual'}`,
      `tags: ${this.tagList(params.tags)}`,
      `created_at: ${this.now()}`, '---',
    ].join('\n');
    const companyLine = params.company ? `**Компания:** ${this.wikiLink(params.company)}\n` : '';
    fs.writeFileSync(path.join(dir, filename), `${frontmatter}\n\n# ${params.title}\n\n${companyLine}${params.body}\n`, 'utf-8');
    return this.userRelative('Ideas', filename);
  }

  async writeInboxItem(originalName: string, content: string): Promise<string> {
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
    const filename = `inbox-${ts}-${this.toSlug(originalName)}.md`;
    const dir = this.userPath('Inbox');
    this.ensureDir(dir);
    fs.writeFileSync(path.join(dir, filename), content, 'utf-8');
    return this.userRelative('Inbox', filename);
  }

  /** Update an existing .md file by vault_path */
  updateTask(vaultRelPath: string, params: WriteTaskParams): void {
    const fullPath = path.join(this.vaultPath, vaultRelPath);
    if (!fs.existsSync(fullPath)) return;
    const people = (params.people ?? []).map((p) => this.wikiLink(p));
    const frontmatter = [
      '---', 'type: task', `status: ${params.status}`,
      `project: ${params.project ? this.wikiLink(params.project) : 'null'}`,
      `priority: ${params.priority}`, `urgency: ${params.urgency}`,
      `due_date: ${params.due_date ?? 'null'}`,
      `people: [${people.join(', ')}]`,
      `tags: [task]`,
      `updated_at: ${this.now()}`, '---',
    ].join('\n');
    // Preserve body content after frontmatter
    const existing = fs.readFileSync(fullPath, 'utf-8');
    const bodyMatch = existing.match(/^---[\s\S]*?---\n*([\s\S]*)$/);
    const body = bodyMatch ? bodyMatch[1] : `\n# ${params.title}\n\n`;
    fs.writeFileSync(fullPath, `${frontmatter}\n\n${body}`, 'utf-8');
  }

  /** Delete (move to trash or remove) a vault file */
  deleteFile(vaultRelPath: string): void {
    const fullPath = path.join(this.vaultPath, vaultRelPath);
    if (fs.existsSync(fullPath)) {
      const trashDir = path.join(this.vaultPath, '.trash');
      this.ensureDir(trashDir);
      const filename = path.basename(fullPath);
      fs.renameSync(fullPath, path.join(trashDir, filename));
    }
  }

  /** Parse frontmatter from a .md file */
  parseFrontmatter(content: string): Record<string, string> {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    const result: Record<string, string> = {};
    for (const line of match[1].split('\n')) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        const key = line.slice(0, idx).trim();
        let val = line.slice(idx + 1).trim();
        // Clean wiki links
        val = val.replace(/\[\[([^\]]+)\]\]/g, '$1');
        // Clean quotes
        val = val.replace(/^["']|["']$/g, '');
        result[key] = val;
      }
    }
    return result;
  }

  /** Get body content (after frontmatter) */
  parseBody(content: string): string {
    const match = content.match(/^---[\s\S]*?---\n*([\s\S]*)$/);
    return match ? match[1].replace(/^#\s+.*\n*/, '').trim() : content.trim();
  }

  /** Read all vault content for AI context */
  readAllForContext(): string {
    const sections: string[] = [];
    for (const folder of ['Projects', 'Tasks', 'Meetings', 'Ideas', 'People', 'Goals', 'Materials']) {
      const files = this.listFolder(folder);
      if (files.length === 0) continue;
      const items: string[] = [];
      for (const f of files) {
        try {
          const content = this.readFile(f);
          const fm = this.parseFrontmatter(content);
          const body = this.parseBody(content);
          const title = path.basename(f, '.md');
          items.push(`### ${title}\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join(', ')}\n${body.slice(0, 500)}`);
        } catch {}
      }
      if (items.length > 0) {
        sections.push(`## ${folder}\n${items.join('\n\n')}`);
      }
    }
    return sections.join('\n\n---\n\n');
  }

  readFile(relativePath: string): string {
    // Try user-scoped path first, fall back to root
    const userScoped = this.userPath(relativePath);
    if (fs.existsSync(userScoped)) {
      return fs.readFileSync(userScoped, 'utf-8');
    }
    return fs.readFileSync(path.join(this.vaultPath, relativePath), 'utf-8');
  }

  listFolder(folder: string): string[] {
    const dir = this.userPath(folder);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => this.userRelative(folder, f));
  }

  initVaultFolders(): void {
    for (const folder of ['Projects', 'People', 'Meetings', 'Ideas', 'Goals', 'Tasks', 'Materials', 'Inbox']) {
      this.ensureDir(this.userPath(folder));
    }
  }
}
