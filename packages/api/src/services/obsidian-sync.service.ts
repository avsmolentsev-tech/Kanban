import * as fs from 'fs';
import * as path from 'path';
import chokidar from 'chokidar';
import matter from 'gray-matter';
import { marked } from 'marked';
import TurndownService from 'turndown';
import { queryOne, execute } from '../db/db';
import { config } from '../config';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

// Add task list support to turndown
turndown.addRule('taskListItem', {
  filter: (node) => {
    return node.nodeName === 'LI' && node.parentElement?.getAttribute('data-type') === 'taskList';
  },
  replacement: (content, node) => {
    const checked = (node as Element).getAttribute('data-checked') === 'true';
    return `- [${checked ? 'x' : ' '}] ${content.trim()}\n`;
  },
});

/** Convert HTML (from Tiptap) to Markdown for Obsidian */
export function htmlToMarkdown(html: string): string {
  if (!html || html === '<p></p>') return '';
  return turndown.turndown(html).trim();
}

/** Convert Markdown (from Obsidian) to HTML for Tiptap */
export function markdownToHtml(md: string): string {
  if (!md) return '';
  return marked.parse(md, { async: false }) as string;
}

/** Sync a document from PIS to Obsidian vault */
export async function syncDocToVault(docId: number, userId: number | null): Promise<void> {
  const doc = await queryOne<Record<string, unknown>>('SELECT * FROM documents WHERE id = $1', [docId]);
  if (!doc) return;

  const title = doc['title'] as string;
  const body = doc['body'] as string;
  const category = doc['category'] as string;
  const status = doc['status'] as string;
  const projectId = doc['project_id'] as number | null;
  const parentId = doc['parent_id'] as number | null;

  // Get project name
  let projectName: string | undefined;
  if (projectId) {
    const proj = await queryOne<{ name: string }>(
      'SELECT name FROM projects WHERE id = $1',
      [projectId]
    );
    projectName = proj?.name;
  }

  // Get parent doc title for nested path
  let parentTitle: string | undefined;
  if (parentId) {
    const parent = await queryOne<{ title: string }>(
      'SELECT title FROM documents WHERE id = $1',
      [parentId]
    );
    parentTitle = parent?.title;
  }

  // Build file path
  const userPrefix = userId ? `user_${userId}` : '';
  const slug = title.replace(/[<>:"/\\|?*]/g, '').trim();
  const filename = `${slug}.md`;

  let relParts: string[];
  if (projectName) {
    if (parentTitle) {
      const parentSlug = parentTitle.replace(/[<>:"/\\|?*]/g, '').trim();
      relParts = [userPrefix, 'Projects', projectName, parentSlug, filename].filter(Boolean);
    } else {
      relParts = [userPrefix, 'Projects', projectName, filename].filter(Boolean);
    }
  } else {
    relParts = [userPrefix, 'Materials', filename].filter(Boolean);
  }

  const fullDir = path.join(config.vaultPath, ...relParts.slice(0, -1));
  if (!fs.existsSync(fullDir)) fs.mkdirSync(fullDir, { recursive: true });

  // Convert HTML to Markdown
  const mdBody = htmlToMarkdown(body);

  // Build frontmatter
  const fm: Record<string, unknown> = {
    type: 'document',
    title,
    category,
    status,
    project: projectName ?? null,
    created_at: doc['created_at'],
    modified_at: new Date().toISOString(),
  };

  const content = matter.stringify(`\n${mdBody}\n`, fm);
  const fullPath = path.join(config.vaultPath, ...relParts);
  fs.writeFileSync(fullPath, content, 'utf-8');

  // Update vault_path in DB
  const vaultPath = relParts.join('/');
  await execute('UPDATE documents SET vault_path = $1 WHERE id = $2', [vaultPath, docId]);
  console.log(`[obsidian-sync] PIS→Vault: doc #${docId} → ${vaultPath}`);
}

/** Sync a file from Obsidian vault to PIS */
export async function syncVaultToDoc(filePath: string, userId: number | null): Promise<void> {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const { data: fm, content } = matter(raw);

  // Only handle document types
  if (fm.type && fm.type !== 'document') return;

  const title = (fm.title as string) ?? path.basename(filePath, '.md');
  const htmlBody = markdownToHtml(content.trim());

  // Find by vault_path
  const vaultRelative = path.relative(config.vaultPath, filePath).replace(/\\/g, '/');
  const existing = await queryOne<{ id: number }>(
    'SELECT id FROM documents WHERE vault_path = $1',
    [vaultRelative]
  );

  if (existing) {
    await execute(
      'UPDATE documents SET title = $1, body = $2, updated_at = $3 WHERE id = $4',
      [title, htmlBody, new Date().toISOString(), existing.id]
    );
    console.log(`[obsidian-sync] Vault→PIS: updated doc #${existing.id}`);
  } else {
    // Create new document
    const category = (fm.category as string) ?? 'note';
    const projectName = fm.project as string | null;
    let projectId: number | null = null;
    if (projectName) {
      const proj = await queryOne<{ id: number }>(
        'SELECT id FROM projects WHERE name = $1',
        [projectName]
      );
      projectId = proj?.id ?? null;
    }
    const result = await queryOne<{ id: number }>(
      'INSERT INTO documents (title, body, project_id, category, vault_path, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [title, htmlBody, projectId, category, vaultRelative, userId]
    );
    console.log(`[obsidian-sync] Vault→PIS: created doc #${result?.id}`);
  }
}

/** Start file watcher for bidirectional sync */
export function startVaultWatcher(userId: number | null): chokidar.FSWatcher | null {
  const watchDir = userId
    ? path.join(config.vaultPath, `user_${userId}`, 'Projects')
    : path.join(config.vaultPath, 'Projects');

  if (!fs.existsSync(watchDir)) {
    fs.mkdirSync(watchDir, { recursive: true });
  }

  // Debounce per-file
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const watcher = chokidar.watch(watchDir, {
    ignored: /(^|[/\\])\../,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 },
  });

  watcher.on('change', (filePath) => {
    if (!filePath.endsWith('.md')) return;
    const existing = debounceTimers.get(filePath);
    if (existing) clearTimeout(existing);
    debounceTimers.set(
      filePath,
      setTimeout(() => {
        debounceTimers.delete(filePath);
        syncVaultToDoc(filePath, userId).catch(err => {
          console.warn('[obsidian-sync] watcher error:', err);
        });
      }, 1000),
    );
  });

  watcher.on('add', (filePath) => {
    if (!filePath.endsWith('.md')) return;
    setTimeout(() => {
      syncVaultToDoc(filePath, userId).catch(err => {
        console.warn('[obsidian-sync] watcher add error:', err);
      });
    }, 1500);
  });

  console.log(`[obsidian-sync] watching ${watchDir}`);
  return watcher;
}
