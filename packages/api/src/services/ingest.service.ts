import { queryAll, queryOne, execute } from '../db/db';
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
    const fileType = detectFileType(originalFilename);

    const inserted = await queryOne<{ id: number }>(
      'INSERT INTO inbox_items (original_filename, file_type) VALUES ($1, $2) RETURNING id',
      [originalFilename, fileType]
    );
    const itemId = inserted!.id;

    try {
      const extractedText = await parseFile(buffer, fileType);
      await execute('UPDATE inbox_items SET extracted_text = $1 WHERE id = $2', [extractedText, itemId]);

      const analysis = await this.claude.parseInboxItem(extractedText, fileType);
      const createdRecords: IngestResult['created_records'] = [];

      const matchedProjectId = await this.matchProject(analysis.project_hints ?? [], userId);
      const matchedPeopleIds = await this.matchPeople(analysis.people ?? [], userId);

      if (analysis.detected_type === 'meeting') {
        const date = analysis.date ?? new Date().toISOString().split('T')[0]!;
        let projectName: string | undefined;
        if (matchedProjectId) {
          const proj = await queryOne<{ name: string }>(
            'SELECT name FROM projects WHERE id = $1 AND user_id = $2',
            [matchedProjectId, userId]
          );
          projectName = proj?.name;
        }
        const fullContent = `${analysis.summary}\n\n---\n\n## Полная транскрипция\n\n${extractedText}`;
        const vaultPath = await this.obsidian.forUser(userId).writeMeeting({
          title: analysis.title, date, people: analysis.people,
          summary: fullContent, agreements: analysis.agreements.length,
          source: originalFilename, project: projectName,
        });
        const meetingInserted = await queryOne<{ id: number }>(
          'INSERT INTO meetings (user_id, title, date, project_id, summary_raw, summary_structured, vault_path, source_file, processed) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1) RETURNING id',
          [userId, analysis.title, date, matchedProjectId, fullContent, JSON.stringify(analysis), vaultPath, originalFilename]
        );
        const meetingId = meetingInserted!.id;
        for (const pid of matchedPeopleIds) {
          await execute(
            'INSERT INTO meeting_people (meeting_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [meetingId, pid]
          );
        }
        if (matchedProjectId) {
          await execute(
            'INSERT INTO meeting_projects (meeting_id, project_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [meetingId, matchedProjectId]
          );
        }
        createdRecords.push({ type: 'meeting', id: meetingId, title: analysis.title, vault_path: vaultPath });

        const tasksFromMeeting = analysis.tasks ?? [];
        const selfRow = await queryOne<{ id: number }>(
          "SELECT id FROM people WHERE user_id = $1 AND LOWER(name) IN ('я','me','self') LIMIT 1",
          [userId]
        );
        for (const taskTitle of tasksFromMeeting) {
          if (!taskTitle || typeof taskTitle !== 'string') continue;
          try {
            const taskInserted = await queryOne<{ id: number }>(
              'INSERT INTO tasks (user_id, project_id, title, description, status, priority) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
              [userId, matchedProjectId, taskTitle, `Из встречи: ${analysis.title}`, 'backlog', 3]
            );
            const newTaskId = taskInserted!.id;
            if (selfRow) {
              await execute(
                'INSERT INTO task_people (task_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [newTaskId, selfRow.id]
              );
            }
            createdRecords.push({ type: 'task', id: newTaskId, title: taskTitle, vault_path: null });
          } catch {}
        }
      } else if (analysis.detected_type === 'task') {
        const date = analysis.date ?? null;
        const taskInserted = await queryOne<{ id: number }>(
          'INSERT INTO tasks (user_id, project_id, title, description, status, priority, due_date) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
          [userId, matchedProjectId, analysis.title, analysis.summary, 'todo', 3, date]
        );
        const taskId = taskInserted!.id;
        for (const pid of matchedPeopleIds) {
          await execute(
            'INSERT INTO task_people (task_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [taskId, pid]
          );
        }
        let projectName: string | undefined;
        if (matchedProjectId) {
          const proj = await queryOne<{ name: string }>(
            'SELECT name FROM projects WHERE id = $1 AND user_id = $2',
            [matchedProjectId, userId]
          );
          projectName = proj?.name;
        }
        const vaultPath = await this.obsidian.forUser(userId).writeTask({
          title: analysis.title, status: 'todo', priority: 3, urgency: 3,
          project: projectName,
          due_date: date,
        });
        await execute(
          'UPDATE tasks SET vault_path = $1 WHERE id = $2 AND user_id = $3',
          [vaultPath, taskId, userId]
        );
        createdRecords.push({ type: 'task', id: taskId, title: analysis.title, vault_path: vaultPath });
      } else if (analysis.detected_type === 'idea') {
        const ideaInserted = await queryOne<{ id: number }>(
          'INSERT INTO ideas (user_id, title, body, category, project_id, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
          [userId, analysis.title, analysis.summary, 'personal', matchedProjectId, 'backlog']
        );
        createdRecords.push({ type: 'idea', id: ideaInserted!.id, title: analysis.title, vault_path: null });
      } else {
        const vaultPath = await this.obsidian.forUser(userId).writeInboxItem(
          originalFilename, `# ${analysis.title}\n\n${analysis.summary}\n\n---\n\n${extractedText}`
        );
        createdRecords.push({ type: 'inbox', id: itemId, title: analysis.title, vault_path: vaultPath });
      }

      await execute(
        'UPDATE inbox_items SET processed = 1, target_type = $1, target_id = $2 WHERE id = $3',
        [analysis.detected_type, createdRecords[0]?.id ?? null, itemId]
      );

      return { inbox_item_id: itemId, detected_type: analysis.detected_type as IngestTargetType, created_records: createdRecords, summary: analysis.summary };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await execute('UPDATE inbox_items SET error = $1 WHERE id = $2', [message, itemId]);
      throw err;
    }
  }

  /** Fuzzy match project by name hints, scoped to user */
  private async matchProject(hints: string[], userId: number): Promise<number | null> {
    if (hints.length === 0) return null;
    const projects = await queryAll<{ id: number; name: string }>(
      'SELECT id, name FROM projects WHERE archived = 0 AND user_id = $1',
      [userId]
    );
    for (const hint of hints) {
      const lower = hint.toLowerCase();
      const match = projects.find((p) => p.name.toLowerCase().includes(lower) || lower.includes(p.name.toLowerCase()));
      if (match) return match.id;
    }
    return null;
  }

  /** Match existing people (scoped to user) or create new ones owned by user */
  private async matchPeople(names: string[], userId: number): Promise<number[]> {
    if (names.length === 0) return [];
    const existing = await queryAll<{ id: number; name: string }>(
      'SELECT id, name FROM people WHERE user_id = $1',
      [userId]
    );
    const ids: number[] = [];
    for (const name of names) {
      const lower = name.toLowerCase().trim();
      if (!lower) continue;
      const match = existing.find((p) => p.name.toLowerCase() === lower || p.name.toLowerCase().includes(lower) || lower.includes(p.name.toLowerCase()));
      if (match) {
        ids.push(match.id);
      } else {
        const result = await queryOne<{ id: number }>(
          'INSERT INTO people (user_id, name) VALUES ($1, $2) RETURNING id',
          [userId, name.trim()]
        );
        const newId = result!.id;
        existing.push({ id: newId, name: name.trim() });
        ids.push(newId);
      }
    }
    return ids;
  }

  async ingestText(text: string, userId: number | null = null): Promise<IngestResult> {
    return this.ingestBuffer(Buffer.from(text, 'utf-8'), 'paste.txt', userId);
  }

  async getStatus(id: number): Promise<unknown> {
    return queryOne('SELECT * FROM inbox_items WHERE id = $1', [id]);
  }
}
