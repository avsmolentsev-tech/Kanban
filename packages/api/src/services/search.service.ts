import * as fs from 'fs';
import * as path from 'path';
import { getDb } from '../db/db';
import { config } from '../config';

export interface SearchHit {
  type: string;
  ref_id: number;
  title: string;
  snippet: string;
  rank: number;
}

export class SearchService {
  indexRecord(type: string, refId: number, title: string, body: string): void {
    const db = getDb();
    // Remove existing entry
    db.prepare('DELETE FROM search_index WHERE type = ? AND ref_id = ?').run(type, refId);
    // Insert new
    db.prepare('INSERT INTO search_index (type, ref_id, title, body) VALUES (?, ?, ?, ?)').run(type, refId, title, body);
  }

  removeRecord(type: string, refId: number): void {
    getDb().prepare('DELETE FROM search_index WHERE type = ? AND ref_id = ?').run(type, refId);
  }

  search(query: string, limit = 50): SearchHit[] {
    if (!query.trim()) return [];
    const db = getDb();
    // FTS5 query — append * for prefix matching
    const ftsQuery = query.trim().split(/\s+/).map(w => `"${w}"*`).join(' ');
    try {
      const results = db.prepare(`
        SELECT type, ref_id, title,
          snippet(search_index, 3, '<mark>', '</mark>', '...', 40) as snippet,
          rank
        FROM search_index
        WHERE search_index MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(ftsQuery, limit) as SearchHit[];
      return results;
    } catch {
      // If FTS query fails (syntax), fall back to LIKE
      const like = `%${query.trim()}%`;
      return db.prepare(`
        SELECT type, ref_id, title, substr(body, 1, 200) as snippet, 0 as rank
        FROM search_index
        WHERE title LIKE ? OR body LIKE ?
        LIMIT ?
      `).all(like, like, limit) as SearchHit[];
    }
  }

  reindexAll(): { indexed: number } {
    const db = getDb();
    db.prepare('DELETE FROM search_index').run();

    let count = 0;

    // Index tasks
    const tasks = db.prepare('SELECT id, title, description FROM tasks WHERE archived = 0').all() as Array<{ id: number; title: string; description: string }>;
    for (const t of tasks) {
      this.indexRecord('task', t.id, t.title, t.description);
      count++;
    }

    // Index meetings
    const meetings = db.prepare('SELECT id, title, summary_raw FROM meetings').all() as Array<{ id: number; title: string; summary_raw: string }>;
    for (const m of meetings) {
      this.indexRecord('meeting', m.id, m.title, m.summary_raw);
      count++;
    }

    // Index ideas
    const ideas = db.prepare('SELECT id, title, body FROM ideas').all() as Array<{ id: number; title: string; body: string }>;
    for (const i of ideas) {
      this.indexRecord('idea', i.id, i.title, i.body);
      count++;
    }

    // Index documents
    try {
      const docs = db.prepare('SELECT id, title, body FROM documents').all() as Array<{ id: number; title: string; body: string }>;
      for (const d of docs) {
        this.indexRecord('document', d.id, d.title, d.body);
        count++;
      }
    } catch {} // table might not exist yet

    // Index people
    const people = db.prepare('SELECT id, name, notes FROM people').all() as Array<{ id: number; name: string; notes: string }>;
    for (const p of people) {
      this.indexRecord('person', p.id, p.name, p.notes);
      count++;
    }

    // Index vault .md files
    count += this.indexVaultFiles();

    return { indexed: count };
  }

  private indexVaultFiles(): number {
    let count = 0;
    const vaultPath = config.vaultPath;
    if (!fs.existsSync(vaultPath)) return 0;

    const folders = ['Tasks', 'Meetings', 'Ideas', 'Materials', 'Inbox', 'Projects', 'Goals'];
    for (const folder of folders) {
      const dir = path.join(vaultPath, folder);
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(dir, file), 'utf-8');
          const title = file.replace('.md', '');
          // Use negative ref_id to distinguish vault files from DB records
          this.indexRecord('vault', -(count + 1), `${folder}/${title}`, content);
          count++;
        } catch {}
      }
    }
    return count;
  }

  startVaultWatcher(): void {
    const vaultPath = config.vaultPath;
    if (!fs.existsSync(vaultPath)) return;

    // Debounce map to avoid processing the same file multiple times
    const pending = new Map<string, NodeJS.Timeout>();

    try {
      fs.watch(vaultPath, { recursive: true }, (eventType, filename) => {
        if (!filename || !filename.endsWith('.md')) return;

        // Debounce — wait 500ms before processing
        if (pending.has(filename)) clearTimeout(pending.get(filename));
        pending.set(filename, setTimeout(() => {
          pending.delete(filename);
          const fullPath = path.join(vaultPath, filename);
          try {
            if (fs.existsSync(fullPath)) {
              const content = fs.readFileSync(fullPath, 'utf-8');
              const title = path.basename(filename, '.md');
              const refId = -(Math.abs(this.hashCode(filename)) % 1000000);
              this.indexRecord('vault', refId, title, content);

              // Sync back to DB if it's a task/meeting file with frontmatter
              this.syncVaultFileToDb(filename, content);
            } else {
              // File deleted in Obsidian → archive in DB
              this.archiveDeletedVaultFile(filename);
            }
          } catch {}
        }, 500));
      });
      console.log('[search] vault watcher started');
    } catch (err) {
      console.warn('[search] vault watcher failed:', err);
    }
  }

  /** Parse vault .md file and sync changes back to database */
  private syncVaultFileToDb(filename: string, content: string): void {
    try {
      const db = getDb();
      const fm = this.parseFrontmatter(content);
      if (!fm['type']) return;

      // Find task by vault_path
      const vaultRelPath = filename.replace(/\\/g, '/');

      if (fm['type'] === 'task') {
        const task = db.prepare('SELECT id FROM tasks WHERE vault_path = ?').get(vaultRelPath) as { id: number } | undefined;
        if (!task) return;

        const updates: string[] = [];
        const values: unknown[] = [];

        if (fm['status'] && ['backlog', 'todo', 'in_progress', 'done', 'someday'].includes(fm['status'])) {
          updates.push('status = ?'); values.push(fm['status']);
        }
        if (fm['priority']) { updates.push('priority = ?'); values.push(Number(fm['priority'])); }
        if (fm['urgency']) { updates.push('urgency = ?'); values.push(Number(fm['urgency'])); }
        if (fm['due_date'] && fm['due_date'] !== 'null') { updates.push('due_date = ?'); values.push(fm['due_date']); }

        if (updates.length > 0) {
          db.prepare(`UPDATE tasks SET ${updates.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`).run(...values, task.id);
          console.log(`[vault-sync] updated task #${task.id} from ${vaultRelPath}`);
        }
      }
    } catch {}
  }

  /** Archive DB records when vault file is deleted */
  private archiveDeletedVaultFile(filename: string): void {
    try {
      const db = getDb();
      const vaultRelPath = filename.replace(/\\/g, '/');

      // Check tasks
      const task = db.prepare('SELECT id FROM tasks WHERE vault_path = ?').get(vaultRelPath) as { id: number } | undefined;
      if (task) {
        db.prepare("UPDATE tasks SET archived = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").run(task.id);
        console.log(`[vault-sync] archived task #${task.id} (file deleted: ${vaultRelPath})`);
        return;
      }

      // Check meetings
      const meeting = db.prepare('SELECT id FROM meetings WHERE vault_path = ?').get(vaultRelPath) as { id: number } | undefined;
      if (meeting) {
        db.prepare('DELETE FROM meeting_people WHERE meeting_id = ?').run(meeting.id);
        db.prepare('DELETE FROM meetings WHERE id = ?').run(meeting.id);
        console.log(`[vault-sync] deleted meeting #${meeting.id} (file deleted: ${vaultRelPath})`);
        return;
      }
    } catch {}
  }

  private parseFrontmatter(content: string): Record<string, string> {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    const result: Record<string, string> = {};
    for (const line of match[1].split('\n')) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        let val = line.slice(idx + 1).trim();
        val = val.replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/^["']|["']$/g, '');
        result[line.slice(0, idx).trim()] = val;
      }
    }
    return result;
  }

  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return hash;
  }
}

export const searchService = new SearchService();
