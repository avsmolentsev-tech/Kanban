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

      if (analysis.detected_type === 'meeting') {
        const date = analysis.date ?? new Date().toISOString().split('T')[0]!;
        const vaultPath = await this.obsidian.writeMeeting({
          title: analysis.title, date, people: analysis.people,
          summary: analysis.summary, agreements: analysis.agreements.length,
          source: originalFilename,
        });
        const result = db.prepare(
          'INSERT INTO meetings (title, date, summary_raw, summary_structured, vault_path, source_file, processed) VALUES (?, ?, ?, ?, ?, ?, 1)'
        ).run(analysis.title, date, extractedText, JSON.stringify(analysis), vaultPath, originalFilename);
        createdRecords.push({ type: 'meeting', id: Number(result.lastInsertRowid), title: analysis.title, vault_path: vaultPath });
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

  async ingestText(text: string): Promise<IngestResult> {
    return this.ingestBuffer(Buffer.from(text, 'utf-8'), 'paste.txt');
  }

  getStatus(id: number): unknown {
    return getDb().prepare('SELECT * FROM inbox_items WHERE id = ?').get(id);
  }
}
