import * as fs from 'fs';
import * as path from 'path';
import { queryAll, queryOne, execute } from '../db/db';
import { config } from '../config';

export interface SearchHit {
  type: string;
  ref_id: number;
  title: string;
  snippet: string;
  rank: number;
}

export class SearchService {
  /** No-op: tsvector on tasks is maintained by DB trigger */
  async indexRecord(_type: string, _refId: number, _title: string, _body: string): Promise<void> {
    // no-op — trigger handles tasks; other entities use ILIKE search
  }

  /** No-op */
  async removeRecord(_type: string, _refId: number): Promise<void> {
    // no-op
  }

  async search(query: string, limit = 50, userId?: number | null): Promise<SearchHit[]> {
    if (!query.trim()) return [];
    // Fail closed: without a user context we must not search across everyone's data.
    if (userId === null || userId === undefined) return [];
    const q = query.trim();
    const likeQ = `%${q}%`;
    const results: SearchHit[] = [];

    try {
      // Tasks: use tsvector full-text search
      const tasks = await queryAll<{ id: number; title: string; rank: number }>(
        `SELECT id, title, ts_rank(search_vector, plainto_tsquery('russian', $1)) as rank
         FROM tasks
         WHERE search_vector @@ plainto_tsquery('russian', $1) AND archived = 0 AND user_id = $3
         ORDER BY rank DESC
         LIMIT $2`,
        [q, limit, userId]
      );
      for (const t of tasks) {
        results.push({ type: 'task', ref_id: t.id, title: t.title, snippet: '', rank: t.rank });
      }

      // Meetings: ILIKE
      const meetings = await queryAll<{ id: number; title: string; summary_raw: string }>(
        'SELECT id, title, summary_raw FROM meetings WHERE (title ILIKE $1 OR summary_raw ILIKE $1) AND user_id = $3 LIMIT $2',
        [likeQ, limit, userId]
      );
      for (const m of meetings) {
        const snippet = (m.summary_raw ?? '').slice(0, 200);
        results.push({ type: 'meeting', ref_id: m.id, title: m.title, snippet, rank: 0 });
      }

      // Ideas: ILIKE
      const ideas = await queryAll<{ id: number; title: string; body: string }>(
        'SELECT id, title, body FROM ideas WHERE (title ILIKE $1 OR body ILIKE $1) AND user_id = $3 LIMIT $2',
        [likeQ, limit, userId]
      );
      for (const i of ideas) {
        results.push({ type: 'idea', ref_id: i.id, title: i.title, snippet: (i.body ?? '').slice(0, 200), rank: 0 });
      }

      // Documents: ILIKE
      try {
        const docs = await queryAll<{ id: number; title: string; body: string }>(
          'SELECT id, title, body FROM documents WHERE (title ILIKE $1 OR body ILIKE $1) AND user_id = $3 LIMIT $2',
          [likeQ, limit, userId]
        );
        for (const d of docs) {
          results.push({ type: 'document', ref_id: d.id, title: d.title, snippet: (d.body ?? '').slice(0, 200), rank: 0 });
        }
      } catch {}

      // People: ILIKE
      const people = await queryAll<{ id: number; name: string; notes: string }>(
        'SELECT id, name, notes FROM people WHERE (name ILIKE $1 OR notes ILIKE $1) AND user_id = $3 LIMIT $2',
        [likeQ, limit, userId]
      );
      for (const p of people) {
        results.push({ type: 'person', ref_id: p.id, title: p.name, snippet: (p.notes ?? '').slice(0, 200), rank: 0 });
      }
    } catch (err) {
      console.warn('[search] search error:', err);
    }

    // Sort: FTS results first (rank > 0), then ILIKE; limit total
    results.sort((a, b) => b.rank - a.rank);
    return results.slice(0, limit);
  }

  async reindexAll(): Promise<{ indexed: number }> {
    // Rebuild tsvector for tasks (trigger handles new inserts/updates going forward)
    await execute(
      `UPDATE tasks SET search_vector = setweight(to_tsvector('russian', COALESCE(title, '')), 'A') || setweight(to_tsvector('russian', COALESCE(description, '')), 'B')`
    );

    // Count what we have for reporting
    let count = 0;
    const taskCount = await queryOne<{ c: number }>('SELECT COUNT(*) as c FROM tasks WHERE archived = 0');
    count += taskCount?.c ?? 0;
    const meetingCount = await queryOne<{ c: number }>('SELECT COUNT(*) as c FROM meetings');
    count += meetingCount?.c ?? 0;
    const ideaCount = await queryOne<{ c: number }>('SELECT COUNT(*) as c FROM ideas');
    count += ideaCount?.c ?? 0;

    // Index vault files (no-op for DB, just count)
    count += this.indexVaultFiles();

    return { indexed: count };
  }

  private indexVaultFiles(): number {
    let count = 0;
    const vaultPath = config.vaultPath;
    if (!fs.existsSync(vaultPath)) return 0;

    const folders = ['Tasks', 'Meetings', 'Ideas', 'Materials', 'Inbox', 'Projects', 'Goals'];

    // Index files in root vault folders (legacy)
    count += this.countVaultFolders(vaultPath, folders);

    // Index user-specific vault folders (user_N/)
    try {
      const entries = fs.readdirSync(vaultPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('user_')) {
          const userDir = path.join(vaultPath, entry.name);
          count += this.countVaultFolders(userDir, folders);
        }
      }
    } catch {}

    return count;
  }

  private countVaultFolders(basePath: string, folders: string[]): number {
    let count = 0;
    for (const folder of folders) {
      const dir = path.join(basePath, folder);
      if (!fs.existsSync(dir)) continue;
      count += fs.readdirSync(dir).filter(f => f.endsWith('.md')).length;
    }
    return count;
  }

  startVaultWatcher(): void {
    const vaultPath = config.vaultPath;
    if (!fs.existsSync(vaultPath)) return;

    // Debounce map to avoid processing the same file multiple times
    const pending = new Map<string, NodeJS.Timeout>();

    try {
      fs.watch(vaultPath, { recursive: true }, (_eventType, filename) => {
        if (!filename || !filename.endsWith('.md')) return;

        // Debounce — wait 500ms before processing
        if (pending.has(filename)) clearTimeout(pending.get(filename));
        pending.set(filename, setTimeout(() => {
          pending.delete(filename);
          const fullPath = path.join(vaultPath, filename);
          try {
            if (fs.existsSync(fullPath)) {
              const content = fs.readFileSync(fullPath, 'utf-8');

              // Sync back to DB if it's a task/meeting file with frontmatter
              this.syncVaultFileToDb(filename, content).catch(() => {});
            } else {
              // File deleted in Obsidian → archive in DB
              this.archiveDeletedVaultFile(filename).catch(() => {});
            }
          } catch {}
        }, 500));
      });
      console.log('[search] vault watcher started');
    } catch (err) {
      console.warn('[search] vault watcher failed:', err);
    }
  }

  /** Extract user_id from vault path like "user_2/Tasks/..." → 2, or null for root paths */
  private extractUserIdFromPath(vaultRelPath: string): number | null {
    const match = vaultRelPath.match(/^user_(\d+)\//);
    return match ? Number(match[1]) : null;
  }

  /** Check if path contains a Meetings folder (root or user-scoped) */
  private isMeetingPath(vaultRelPath: string): boolean {
    return /(?:^|\/)Meetings\//.test(vaultRelPath);
  }

  /** Parse vault .md file and sync changes back to database */
  private async syncVaultFileToDb(filename: string, content: string): Promise<void> {
    try {
      const vaultRelPath = filename.replace(/\\/g, '/');

      // Check if it's in Meetings folder → handle as new meeting
      if (this.isMeetingPath(vaultRelPath)) {
        await this.syncMeetingFromVault(vaultRelPath, content);
        return;
      }

      const fm = this.parseFrontmatter(content);
      if (!fm['type']) return;

      if (fm['type'] === 'task') {
        const task = await queryOne<{ id: number }>(
          'SELECT id FROM tasks WHERE vault_path = $1',
          [vaultRelPath]
        );
        if (!task) return;

        const updates: string[] = [];
        const values: unknown[] = [];
        let paramIdx = 1;

        if (fm['status'] && ['backlog', 'todo', 'in_progress', 'done', 'someday'].includes(fm['status'])) {
          updates.push(`status = $${paramIdx++}`); values.push(fm['status']);
        }
        if (fm['priority']) { updates.push(`priority = $${paramIdx++}`); values.push(Number(fm['priority'])); }
        if (fm['urgency']) { updates.push(`urgency = $${paramIdx++}`); values.push(Number(fm['urgency'])); }
        if (fm['due_date'] && fm['due_date'] !== 'null') { updates.push(`due_date = $${paramIdx++}`); values.push(fm['due_date']); }

        if (updates.length > 0) {
          values.push(task.id);
          await execute(
            `UPDATE tasks SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramIdx}`,
            values
          );
          console.log(`[vault-sync] updated task #${task.id} from ${vaultRelPath}`);
        }
      }
    } catch {}
  }

  /** Sync meeting from vault file. If new — create record + extract tasks via AI */
  private async syncMeetingFromVault(vaultRelPath: string, content: string): Promise<void> {
    try {
      const existing = await queryOne<{ id: number }>(
        'SELECT id FROM meetings WHERE vault_path = $1',
        [vaultRelPath]
      );
      if (existing) return; // Already exists, don't re-extract tasks

      // Parse frontmatter for metadata
      const fm = this.parseFrontmatter(content);
      const body = content.replace(/^---[\s\S]*?---\n*/, '').trim();
      if (body.length < 50) return; // Skip empty/tiny files

      // Extract title from filename or first heading
      const filename = vaultRelPath.split('/').pop()!.replace('.md', '');
      const titleMatch = body.match(/^#\s+(.+)$/m);
      const title = titleMatch?.[1] ?? fm['title'] ?? filename;
      const date = fm['date'] ?? new Date().toISOString().split('T')[0]!;

      // Try to match project by frontmatter or filename
      const projects = await queryAll<{ id: number; name: string }>(
        'SELECT id, name FROM projects WHERE archived = 0'
      );
      let projectId: number | null = null;
      const projectHint = (fm['project'] ?? '').toLowerCase();
      if (projectHint) {
        const match = projects.find(p => p.name.toLowerCase().includes(projectHint) || projectHint.includes(p.name.toLowerCase()));
        if (match) projectId = match.id;
      }

      // Resolve user_id from path
      const userId = this.extractUserIdFromPath(vaultRelPath);

      // Create meeting record
      const inserted = await queryOne<{ id: number }>(
        'INSERT INTO meetings (title, date, project_id, summary_raw, vault_path, processed, user_id) VALUES ($1, $2, $3, $4, $5, 1, $6) RETURNING id',
        [title, date, projectId, body, vaultRelPath, userId]
      );
      const meetingId = inserted!.id;
      if (projectId) {
        await execute(
          'INSERT INTO meeting_projects (meeting_id, project_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [meetingId, projectId]
        );
      }
      console.log(`[vault-sync] created meeting #${meetingId} from ${vaultRelPath}`);

      // Extract tasks via AI (async, don't block watcher)
      this.extractTasksFromMeeting(meetingId, title, body, projectId, userId).catch(err => {
        console.warn('[vault-sync] task extraction failed:', err);
      });
    } catch (err) {
      console.warn('[vault-sync] syncMeetingFromVault failed:', err);
    }
  }

  /** Extract real, attributed, quote-backed action items from a meeting and create tasks. */
  private async extractTasksFromMeeting(meetingId: number, title: string, body: string, projectId: number | null, userId?: number | null): Promise<void> {
    try {
      const { ClaudeService } = require('./claude.service');
      const claude = new ClaudeService();

      // Participants for owner attribution (scoped to this meeting)
      const peopleRows = await queryAll<{ name: string }>(
        'SELECT p.name FROM people p JOIN meeting_people mp ON p.id = mp.person_id WHERE mp.meeting_id = $1',
        [meetingId]
      );
      const peopleNames = peopleRows.map(p => p.name);

      const items = await claude.extractActionItems(body, title, peopleNames);
      if (!Array.isArray(items) || items.length === 0) return;

      // Existing tasks from THIS meeting (dedup across re-syncs)
      const existing = await queryAll<{ title: string }>(
        "SELECT title FROM tasks WHERE description LIKE $1 AND user_id IS NOT DISTINCT FROM $2",
        [`%[meeting #${meetingId}]%`, userId ?? null]
      );
      const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      const existingKeys = new Set(existing.map(e => norm(e.title)));

      const selfRow = await queryOne<{ id: number }>(
        "SELECT id FROM people WHERE LOWER(name) IN ('я','me','self') AND user_id IS NOT DISTINCT FROM $1 LIMIT 1",
        [userId ?? null]
      );

      const typeLabel: Record<string, string> = {
        my_task: 'Моя задача', their_commitment: 'Обязательство другой стороны',
        mutual_agreement: 'Взаимная договорённость', idea: 'Идея',
      };

      let created = 0;
      for (const it of items as Array<{ title: string; owner: string | null; type: string; due: string | null; quote: string }>) {
        // Ideas are not actionable commitments — don't pollute the task board
        if (it.type === 'idea') continue;
        if (existingKeys.has(norm(it.title))) continue;

        const ownerLabel = it.owner || (it.type === 'my_task' ? 'я' : 'не указан');
        const description = `[meeting #${meetingId}] Из встречи: ${title}\nТип: ${typeLabel[it.type] ?? it.type}\nОтветственный: ${ownerLabel}\nЦитата: «${it.quote}»`;
        try {
          const newTask = await queryOne<{ id: number }>(
            'INSERT INTO tasks (project_id, title, description, status, priority, due_date, user_id, commitment_type, commitment_owner, source_meeting_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id',
            [projectId, it.title, description, 'backlog', 3, it.due, userId ?? null, it.type, ownerLabel, meetingId]
          );
          const newTaskId = newTask!.id;
          existingKeys.add(norm(it.title));

          // Link the responsible person: named owner if we can resolve them, else self
          let ownerPersonId: number | null = null;
          if (it.owner && !['я', 'me', 'self'].includes(it.owner.toLowerCase())) {
            const person = await queryOne<{ id: number }>(
              'SELECT id FROM people WHERE LOWER(name) = LOWER($1) AND user_id IS NOT DISTINCT FROM $2 LIMIT 1',
              [it.owner, userId ?? null]
            );
            ownerPersonId = person?.id ?? null;
          }
          if (ownerPersonId === null && selfRow) ownerPersonId = selfRow.id;
          if (ownerPersonId !== null) {
            await execute(
              'INSERT INTO task_people (task_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [newTaskId, ownerPersonId]
            );
          }
          created++;
        } catch { /* skip failed insert */ }
      }
      if (created > 0) {
        console.log(`[vault-sync] extracted ${created} action items from meeting #${meetingId}`);
      }
    } catch (err) {
      console.warn('[vault-sync] extractTasksFromMeeting error:', err);
    }
  }

  /** Archive DB records when vault file is deleted */
  private async archiveDeletedVaultFile(filename: string): Promise<void> {
    try {
      const vaultRelPath = filename.replace(/\\/g, '/');

      // Check tasks
      const task = await queryOne<{ id: number }>(
        'SELECT id FROM tasks WHERE vault_path = $1',
        [vaultRelPath]
      );
      if (task) {
        await execute(
          'UPDATE tasks SET archived = 1, updated_at = NOW() WHERE id = $1',
          [task.id]
        );
        console.log(`[vault-sync] archived task #${task.id} (file deleted: ${vaultRelPath})`);
        return;
      }

      // Check meetings
      const meeting = await queryOne<{ id: number }>(
        'SELECT id FROM meetings WHERE vault_path = $1',
        [vaultRelPath]
      );
      if (meeting) {
        await execute('DELETE FROM meeting_people WHERE meeting_id = $1', [meeting.id]);
        await execute('DELETE FROM meetings WHERE id = $1', [meeting.id]);
        console.log(`[vault-sync] deleted meeting #${meeting.id} (file deleted: ${vaultRelPath})`);
        return;
      }
    } catch {}
  }

  private parseFrontmatter(content: string): Record<string, string> {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    const result: Record<string, string> = {};
    for (const line of match[1]!.split('\n')) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        let val = line.slice(idx + 1).trim();
        val = val.replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/^["']|["']$/g, '');
        result[line.slice(0, idx).trim()] = val;
      }
    }
    return result;
  }

}

export const searchService = new SearchService();
