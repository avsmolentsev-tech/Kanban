// One-off backfill: create .md files in Obsidian vault for all projects / people / meetings
// of a given user. Re-run is idempotent — files are overwritten with current DB state.
//
// Usage (on server):
//   cd /var/www/kanban-app/packages/api
//   npx tsx src/scripts/backfill-vault.ts <userId>
//
// Example: npx tsx src/scripts/backfill-vault.ts 2

import { getDb, initDb } from '../db/db';
import { ObsidianService } from '../services/obsidian.service';
import { config } from '../config';

async function main(): Promise<void> {
  initDb();
  const userIdArg = process.argv[2];
  if (!userIdArg) {
    console.error('Usage: backfill-vault <userId>');
    process.exit(1);
  }
  const userId = Number(userIdArg);
  if (!Number.isFinite(userId)) {
    console.error(`Invalid userId: ${userIdArg}`);
    process.exit(1);
  }

  const db = getDb();
  const obsidian = new ObsidianService(config.vaultPath).forUser(userId);
  obsidian.initVaultFolders?.();

  // --- Projects ---
  const projects = db.prepare('SELECT id, name, description, status, color FROM projects WHERE user_id = ? AND archived = 0').all(userId) as Array<{ id: number; name: string; description: string | null; status: string | null; color: string | null }>;
  console.log(`[backfill] projects: ${projects.length}`);
  for (const p of projects) {
    const people = (db.prepare('SELECT DISTINCT pe.name FROM people pe JOIN people_projects pp ON pe.id = pp.person_id WHERE pp.project_id = ?').all(p.id) as Array<{ name: string }>).map((x) => x.name);
    const meetings = db.prepare('SELECT title, date FROM meetings WHERE project_id = ? ORDER BY date DESC').all(p.id) as Array<{ title: string; date: string }>;
    await obsidian.writeProject({
      name: p.name,
      description: p.description ?? '',
      status: p.status ?? 'active',
      color: p.color ?? '#6366f1',
      people,
      meetings,
    });
    console.log(`  [project] ${p.name} (${people.length} people, ${meetings.length} meetings)`);
  }

  // --- People ---
  const people = db.prepare('SELECT id, name, company, role FROM people WHERE user_id = ?').all(userId) as Array<{ id: number; name: string; company: string | null; role: string | null }>;
  console.log(`[backfill] people: ${people.length}`);
  for (const person of people) {
    const personProjects = (db.prepare('SELECT p.name FROM projects p JOIN people_projects pp ON p.id = pp.project_id WHERE pp.person_id = ? ORDER BY p.name').all(person.id) as Array<{ name: string }>).map((x) => x.name);
    const personMeetings = db.prepare('SELECT m.title, m.date FROM meetings m JOIN meeting_people mp ON m.id = mp.meeting_id WHERE mp.person_id = ? ORDER BY m.date DESC').all(person.id) as Array<{ title: string; date: string }>;
    await obsidian.writePerson({
      name: person.name,
      company: person.company ?? '',
      role: person.role ?? '',
      projects: personProjects,
      meetings: personMeetings,
    });
    console.log(`  [person] ${person.name} (${personProjects.length} projects, ${personMeetings.length} meetings)`);
  }

  // --- Meetings (re-write with people list) ---
  const meetings = db.prepare('SELECT id, title, date, project_id, summary_raw, vault_path FROM meetings WHERE user_id = ?').all(userId) as Array<{ id: number; title: string; date: string; project_id: number | null; summary_raw: string | null; vault_path: string | null }>;
  console.log(`[backfill] meetings: ${meetings.length}`);
  for (const m of meetings) {
    const projectName = m.project_id ? (db.prepare('SELECT name FROM projects WHERE id = ?').get(m.project_id) as { name: string } | undefined)?.name : undefined;
    const peopleNames = (db.prepare('SELECT p.name FROM people p JOIN meeting_people mp ON p.id = mp.person_id WHERE mp.meeting_id = ?').all(m.id) as Array<{ name: string }>).map((x) => x.name);
    const newPath = await obsidian.writeMeeting({
      title: m.title,
      date: m.date,
      project: projectName,
      summary: m.summary_raw ?? '',
      people: peopleNames,
    });
    if (newPath && newPath !== m.vault_path) {
      db.prepare('UPDATE meetings SET vault_path = ? WHERE id = ?').run(newPath, m.id);
    }
    console.log(`  [meeting] ${m.date} ${m.title} → ${peopleNames.length} people`);
  }

  console.log('[backfill] done ✓');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
