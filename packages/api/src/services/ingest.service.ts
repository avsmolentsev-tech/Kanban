import { getDb } from '../db/db';
import { parseFile, detectFileType } from '../parsers';
import { ClaudeService } from './claude.service';
import { ObsidianService } from './obsidian.service';
import { config } from '../config';
import type { IngestResult, IngestTargetType } from '@pis/shared';

export class IngestService {
  private readonly claude: ClaudeService;
  private readonly obsidian: ObsidianService;

  constructor() {
    this.claude = new ClaudeService();
    this.obsidian = new ObsidianService(config.vaultPath);
  }

  async ingestBuffer(buffer: Buffer, originalFilename: string, userId: number | null = null): Promise<IngestResult> {
    if (userId == null) {
      throw new Error('ingestBuffer requires userId — refusing to create orphan records');
    }
    const db = getDb();
    const fileType = detectFileType(originalFilename);

    const { lastInsertRowid } = db.prepare(
      'INSERT INTO inbox_items (original_filename, file_type) VALUES (?, ?)'
    ).run(originalFilename, fileType);
    const itemId = Number(lastInsertRowid);

    try {
      const extractedText = await parseFile(buffer, fileType);
      db.prepare('UPDATE inbox_items SET extracted_text = ? WHERE id = ?').run(extractedText, itemId);

      const analysis = await this.claude.parseInboxItem(extractedText, fileType);
      const createdRecords: IngestResult['created_records'] = [];

      const matchedProjectId = this.matchProject(analysis.project_hints ?? [], userId);
      const matchedPeopleIds = this.matchPeople(analysis.people ?? [], userId);

      if (analysis.detected_type === 'meeting') {
        const date = analysis.date ?? new Date().toISOString().split('T')[0]!;
        const projectName = matchedProjectId ? (db.prepare('SELECT name FROM projects WHERE id = ? AND user_id = ?').get(matchedProjectId, userId) as { name: string } | undefined)?.name : undefined;
        const fullContent = `${analysis.summary}\n\n---\n\n## Полная транскрипция\n\n${extractedText}`;
        const vaultPath = await this.obsidian.forUser(userId).writeMeeting({
          title: analysis.title, date, people: analysis.people,
          summary: fullContent, agreements: analysis.agreements.length,
          source: originalFilename, project: projectName,
        });
        const result = db.prepare(
          'INSERT INTO meetings (user_id, title, date, project_id, summary_raw, summary_structured, vault_path, source_file, processed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)'
        ).run(userId, analysis.title, date, matchedProjectId, fullContent, JSON.stringify(analysis), vaultPath, originalFilename);
        const meetingId = Number(result.lastInsertRowid);
        for (const pid of matchedPeopleIds) {
          db.prepare('INSERT OR IGNORE INTO meeting_people (meeting_id, person_id) VALUES (?, ?)').run(meetingId, pid);
        }
        if (matchedProjectId) {
          db.prepare('INSERT OR IGNORE INTO meeting_projects (meeting_id, project_id) VALUES (?, ?)').run(meetingId, matchedProjectId);
        }
        createdRecords.push({ type: 'meeting', id: meetingId, title: analysis.title, vault_path: vaultPath });

        const tasksFromMeeting = analysis.tasks ?? [];
        const selfRow = db.prepare("SELECT id FROM people WHERE user_id = ? AND LOWER(name) IN ('я','me','self') LIMIT 1").get(userId) as { id: number } | undefined;
        for (const taskTitle of tasksFromMeeting) {
          if (!taskTitle || typeof taskTitle !== 'string') continue;
          try {
            const tr = db.prepare('INSERT INTO tasks (user_id, project_id, title, description, status, priority) VALUES (?, ?, ?, ?, ?, ?)').run(
              userId, matchedProjectId, taskTitle, `Из встречи: ${analysis.title}`, 'backlog', 3
            );
            const newTaskId = Number(tr.lastInsertRowid);
            if (selfRow) db.prepare('INSERT OR IGNORE INTO task_people (task_id, person_id) VALUES (?, ?)').run(newTaskId, selfRow.id);
            createdRecords.push({ type: 'task', id: newTaskId, title: taskTitle });
          } catch {}
        }
      } else if (analysis.detected_type === 'task') {
        const date = analysis.date ?? null;
        const result = db.prepare('INSERT INTO tasks (user_id, project_id, title, description, status, priority, due_date) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
          userId, matchedProjectId, analysis.title, analysis.summary, 'todo', 3, date
        );
        const taskId = Number(result.lastInsertRowid);
        for (const pid of matchedPeopleIds) {
          db.prepare('INSERT OR IGNORE INTO task_people (task_id, person_id) VALUES (?, ?)').run(taskId, pid);
        }
        const vaultPath = await this.obsidian.forUser(userId).writeTask({
          title: analysis.title, status: 'todo', priority: 3, urgency: 3,
          project: matchedProjectId ? (db.prepare('SELECT name FROM projects WHERE id = ? AND user_id = ?').get(matchedProjectId, userId) as { name: string } | undefined)?.name : undefined,
          due_date: date,
        });
        db.prepare('UPDATE tasks SET vault_path = ? WHERE id = ? AND user_id = ?').run(vaultPath, taskId, userId);
        createdRecords.push({ type: 'task', id: taskId, title: analysis.title, vault_path: vaultPath });
      } else if (analysis.detected_type === 'idea') {
        const result = db.prepare('INSERT INTO ideas (user_id, title, body, category, project_id, status) VALUES (?, ?, ?, ?, ?, ?)').run(
          userId, analysis.title, analysis.summary, 'personal', matchedProjectId, 'backlog'
        );
        createdRecords.push({ type: 'idea', id: Number(result.lastInsertRowid), title: analysis.title });
      } else {
        const vaultPath = await this.obsidian.forUser(userId).writeInboxItem(
          originalFilename, `# ${analysis.title}\n\n${analysis.summary}\n\n---\n\n${extractedText}`
        );
        createdRecords.push({ type: 'inbox', id: itemId, title: analysis.title, vault_path: vaultPath });
      }

      db.prepare('UPDATE inbox_items SET processed = 1, target_type = ?, target_id = ? WHERE id = ?')
        .run(analysis.detected_type, createdRecords[0]?.id ?? null, itemId);

      return { inbox_item_id: itemId, detected_type: analysis.detected_type as IngestTargetType, created_records: createdRecords, summary: analysis.summary };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      db.prepare('UPDATE inbox_items SET error = ? WHERE id = ?').run(message, itemId);
      throw err;
    }
  }

  /** Fuzzy match project by name hints, scoped to user */
  private matchProject(hints: string[], userId: number): number | null {
    if (hints.length === 0) return null;
    const db = getDb();
    const projects = db.prepare('SELECT id, name FROM projects WHERE archived = 0 AND user_id = ?').all(userId) as Array<{ id: number; name: string }>;
    for (const hint of hints) {
      const lower = hint.toLowerCase();
      const match = projects.find((p) => p.name.toLowerCase().includes(lower) || lower.includes(p.name.toLowerCase()));
      if (match) return match.id;
    }
    return null;
  }

  /** Match existing people (scoped to user) or create new ones owned by user */
  private matchPeople(names: string[], userId: number): number[] {
    if (names.length === 0) return [];
    const db = getDb();
    const existing = db.prepare('SELECT id, name FROM people WHERE user_id = ?').all(userId) as Array<{ id: number; name: string }>;
    const ids: number[] = [];
    for (const name of names) {
      const lower = name.toLowerCase().trim();
      if (!lower) continue;
      const match = existing.find((p) => p.name.toLowerCase() === lower || p.name.toLowerCase().includes(lower) || lower.includes(p.name.toLowerCase()));
      if (match) {
        ids.push(match.id);
      } else {
        const result = db.prepare('INSERT INTO people (user_id, name) VALUES (?, ?)').run(userId, name.trim());
        const newId = Number(result.lastInsertRowid);
        existing.push({ id: newId, name: name.trim() });
        ids.push(newId);
      }
    }
    return ids;
  }

  async ingestText(text: string, userId: number | null = null): Promise<IngestResult> {
    return this.ingestBuffer(Buffer.from(text, 'utf-8'), 'paste.txt', userId);
  }

  getStatus(id: number): unknown {
    return getDb().prepare('SELECT * FROM inbox_items WHERE id = ?').get(id);
  }
}
