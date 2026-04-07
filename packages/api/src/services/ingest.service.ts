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

  async ingestBuffer(buffer: Buffer, originalFilename: string): Promise<IngestResult> {
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

      // Match project by hints
      const matchedProjectId = this.matchProject(analysis.project_hints ?? []);
      // Match/create people
      const matchedPeopleIds = this.matchPeople(analysis.people ?? []);

      if (analysis.detected_type === 'meeting') {
        const date = analysis.date ?? new Date().toISOString().split('T')[0]!;
        const projectName = matchedProjectId ? (db.prepare('SELECT name FROM projects WHERE id = ?').get(matchedProjectId) as { name: string } | undefined)?.name : undefined;
        // Full text for Obsidian: AI summary + full transcription
        const fullContent = `## Резюме\n${analysis.summary}\n\n## Полный текст\n${extractedText}`;
        const vaultPath = await this.obsidian.writeMeeting({
          title: analysis.title, date, people: analysis.people,
          summary: fullContent, agreements: analysis.agreements.length,
          source: originalFilename, project: projectName,
        });
        const result = db.prepare(
          'INSERT INTO meetings (title, date, project_id, summary_raw, summary_structured, vault_path, source_file, processed) VALUES (?, ?, ?, ?, ?, ?, ?, 1)'
        ).run(analysis.title, date, matchedProjectId, extractedText, JSON.stringify(analysis), vaultPath, originalFilename);
        const meetingId = Number(result.lastInsertRowid);
        // Link people to meeting
        for (const pid of matchedPeopleIds) {
          db.prepare('INSERT OR IGNORE INTO meeting_people (meeting_id, person_id) VALUES (?, ?)').run(meetingId, pid);
        }
        createdRecords.push({ type: 'meeting', id: meetingId, title: analysis.title, vault_path: vaultPath });
      } else if (analysis.detected_type === 'task') {
        const date = analysis.date ?? null;
        const result = db.prepare('INSERT INTO tasks (project_id, title, description, status, priority, due_date) VALUES (?, ?, ?, ?, ?, ?)').run(
          matchedProjectId, analysis.title, analysis.summary, 'todo', 3, date
        );
        const taskId = Number(result.lastInsertRowid);
        for (const pid of matchedPeopleIds) {
          db.prepare('INSERT OR IGNORE INTO task_people (task_id, person_id) VALUES (?, ?)').run(taskId, pid);
        }
        const vaultPath = await this.obsidian.writeTask({
          title: analysis.title, status: 'todo', priority: 3, urgency: 3,
          project: matchedProjectId ? (db.prepare('SELECT name FROM projects WHERE id = ?').get(matchedProjectId) as { name: string } | undefined)?.name : undefined,
          due_date: date,
        });
        db.prepare('UPDATE tasks SET vault_path = ? WHERE id = ?').run(vaultPath, taskId);
        createdRecords.push({ type: 'task', id: taskId, title: analysis.title, vault_path: vaultPath });
      } else if (analysis.detected_type === 'idea') {
        const date = analysis.date ?? new Date().toISOString().split('T')[0]!;
        const vaultPath = await this.obsidian.writeIdea({
          title: analysis.title, body: analysis.summary, category: 'personal', source: originalFilename, date,
        });
        const result = db.prepare('INSERT INTO ideas (title, body, vault_path) VALUES (?, ?, ?)').run(analysis.title, analysis.summary, vaultPath);
        createdRecords.push({ type: 'idea', id: Number(result.lastInsertRowid), title: analysis.title, vault_path: vaultPath });
      } else {
        const vaultPath = await this.obsidian.writeInboxItem(
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

  /** Fuzzy match project by name hints */
  private matchProject(hints: string[]): number | null {
    if (hints.length === 0) return null;
    const db = getDb();
    const projects = db.prepare('SELECT id, name FROM projects WHERE archived = 0').all() as Array<{ id: number; name: string }>;
    for (const hint of hints) {
      const lower = hint.toLowerCase();
      const match = projects.find((p) => p.name.toLowerCase().includes(lower) || lower.includes(p.name.toLowerCase()));
      if (match) return match.id;
    }
    return null;
  }

  /** Match existing people or create new ones */
  private matchPeople(names: string[]): number[] {
    if (names.length === 0) return [];
    const db = getDb();
    const existing = db.prepare('SELECT id, name FROM people').all() as Array<{ id: number; name: string }>;
    const ids: number[] = [];
    for (const name of names) {
      const lower = name.toLowerCase().trim();
      if (!lower) continue;
      const match = existing.find((p) => p.name.toLowerCase() === lower || p.name.toLowerCase().includes(lower) || lower.includes(p.name.toLowerCase()));
      if (match) {
        ids.push(match.id);
      } else {
        // Create new person
        const result = db.prepare('INSERT INTO people (name) VALUES (?)').run(name.trim());
        const newId = Number(result.lastInsertRowid);
        existing.push({ id: newId, name: name.trim() });
        ids.push(newId);
      }
    }
    return ids;
  }

  async ingestText(text: string): Promise<IngestResult> {
    return this.ingestBuffer(Buffer.from(text, 'utf-8'), 'paste.txt');
  }

  getStatus(id: number): unknown {
    return getDb().prepare('SELECT * FROM inbox_items WHERE id = ?').get(id);
  }
}
