/**
 * One-time script: generate pro summaries (Notes, Q&A, Actions) for all existing meetings.
 * Run: cd packages/api && npx tsx src/scripts/backfill-pro-summaries.ts
 */
import { initPg, queryAll, execute } from '../db/db';
import { ClaudeService } from '../services/claude.service';
import { config } from '../config';

initPg(config.databaseUrl);

async function main() {
  const claude = new ClaudeService();

  const meetings = await queryAll<{ id: number; title: string; summary_raw: string; summary_structured: string | null }>(`
    SELECT id, title, summary_raw, summary_structured
    FROM meetings
    WHERE user_id = 2
      AND summary_raw IS NOT NULL
      AND length(summary_raw) > 200
    ORDER BY id ASC
  `, []);

  console.log(`Found ${meetings.length} meetings to process\n`);

  let done = 0;
  let skipped = 0;
  let failed = 0;

  for (const m of meetings) {
    // Check if already has pro summaries
    try {
      const existing = JSON.parse(m.summary_structured || '{}');
      if (existing.notes && existing.qa && existing.actions) {
        console.log(`[${m.id}] SKIP: "${m.title}" — already has pro summaries`);
        skipped++;
        continue;
      }
    } catch {}

    // Extract transcript from structured data or raw
    let transcript = '';
    try {
      const structured = JSON.parse(m.summary_structured || '{}');
      transcript = structured.transcript || '';
    } catch {}
    if (!transcript) {
      // Fallback: use summary_raw (might contain transcript after ---)
      const raw = m.summary_raw;
      const sepIdx = raw.indexOf('\n\n---\n\n');
      transcript = sepIdx !== -1 ? raw.slice(sepIdx + 7) : raw;
    }

    if (transcript.length < 100) {
      console.log(`[${m.id}] SKIP: "${m.title}" — transcript too short (${transcript.length} chars)`);
      skipped++;
      continue;
    }

    // Extract people from DB
    const peopleRows = await queryAll<{ name: string }>(`
      SELECT p.name FROM people p
      JOIN meeting_people mp ON p.id = mp.person_id
      WHERE mp.meeting_id = $1
    `, [m.id]);
    const people = peopleRows.map(p => p.name);

    console.log(`[${m.id}] Processing: "${m.title}" (${transcript.length} chars, ${people.length} people)...`);

    try {
      const summaries = await claude.generateProSummaries(transcript, m.title, people);

      // Preserve existing structured data, add pro summaries
      let existing: Record<string, unknown> = {};
      try { existing = JSON.parse(m.summary_structured || '{}'); } catch {}

      const updated = { ...existing, ...summaries };
      await execute(
        'UPDATE meetings SET summary_structured = $1, summary_raw = $2 WHERE id = $3',
        [JSON.stringify(updated), summaries.notes || m.summary_raw, m.id]
      );

      done++;
      console.log(`[${m.id}] DONE ✓\n`);
    } catch (err) {
      failed++;
      console.error(`[${m.id}] FAILED:`, err instanceof Error ? err.message : err);
    }

    // Small delay to not overwhelm OpenAI API
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`\n=== COMPLETE ===`);
  console.log(`Done: ${done}, Skipped: ${skipped}, Failed: ${failed}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
