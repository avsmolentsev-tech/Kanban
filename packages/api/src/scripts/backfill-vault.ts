// One-off backfill: create .md files in Obsidian vault for all projects / people / meetings
// of a given user. Re-run is idempotent — files are overwritten with current DB state.
//
// Usage (on server):
//   cd /var/www/kanban-app/packages/api
//   npx tsx src/scripts/backfill-vault.ts <userId>
//
// Example: npx tsx src/scripts/backfill-vault.ts 2

import { initPg, queryAll, queryOne, execute } from '../db/db';
import { ObsidianService } from '../services/obsidian.service';
import { config } from '../config';

async function main(): Promise<void> {
  await initPg(config.databaseUrl);
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

  const obsidian = new ObsidianService(config.vaultPath).forUser(userId);
  obsidian.initVaultFolders?.();

  // --- Projects ---
  const projects = await queryAll<{ id: number; name: string; description: string | null; status: string | null; color: string | null }>(
    'SELECT id, name, description, status, color FROM projects WHERE user_id = $1 AND archived = 0',
    [userId]
  );
  console.log(`[backfill] projects: ${projects.length}`);
  for (const p of projects) {
    const people = (await queryAll<{ name: string }>(
      'SELECT DISTINCT pe.name FROM people pe JOIN people_projects pp ON pe.id = pp.person_id WHERE pp.project_id = $1',
      [p.id]
    )).map((x) => x.name);
    const meetings = await queryAll<{ title: string; date: string }>(
      'SELECT title, date FROM meetings WHERE project_id = $1 ORDER BY date DESC',
      [p.id]
    );
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
  const people = await queryAll<{ id: number; name: string; company: string | null; role: string | null; phone: string | null; email: string | null; telegram: string | null }>(
    'SELECT id, name, company, role, phone, email, telegram FROM people WHERE user_id = $1',
    [userId]
  );
  console.log(`[backfill] people: ${people.length}`);
  for (const person of people) {
    const personProjects = (await queryAll<{ name: string }>(
      'SELECT p.name FROM projects p JOIN people_projects pp ON p.id = pp.project_id WHERE pp.person_id = $1 ORDER BY p.name',
      [person.id]
    )).map((x) => x.name);
    const personMeetings = await queryAll<{ title: string; date: string }>(
      'SELECT m.title, m.date FROM meetings m JOIN meeting_people mp ON m.id = mp.meeting_id WHERE mp.person_id = $1 ORDER BY m.date DESC',
      [person.id]
    );
    await obsidian.writePerson({
      name: person.name,
      company: person.company ?? '',
      role: person.role ?? '',
      phone: person.phone ?? '',
      email: person.email ?? '',
      telegram: person.telegram ?? '',
      projects: personProjects,
      meetings: personMeetings,
    });
    console.log(`  [person] ${person.name} (${personProjects.length} projects, ${personMeetings.length} meetings)`);
  }

  // --- Meetings (re-write with people list) ---
  const meetings = await queryAll<{ id: number; title: string; date: string; project_id: number | null; summary_raw: string | null; vault_path: string | null }>(
    'SELECT id, title, date, project_id, summary_raw, vault_path FROM meetings WHERE user_id = $1',
    [userId]
  );
  console.log(`[backfill] meetings: ${meetings.length}`);
  for (const m of meetings) {
    const projectRow = m.project_id
      ? await queryOne<{ name: string }>('SELECT name FROM projects WHERE id = $1', [m.project_id])
      : undefined;
    const projectName = projectRow?.name;
    const peopleNames = (await queryAll<{ name: string }>(
      'SELECT p.name FROM people p JOIN meeting_people mp ON p.id = mp.person_id WHERE mp.meeting_id = $1',
      [m.id]
    )).map((x) => x.name);
    const newPath = await obsidian.writeMeeting({
      title: m.title,
      date: m.date,
      project: projectName,
      summary: m.summary_raw ?? '',
      people: peopleNames,
    });
    if (newPath && newPath !== m.vault_path) {
      await execute('UPDATE meetings SET vault_path = $1 WHERE id = $2', [newPath, m.id]);
    }
    console.log(`  [meeting] ${m.date} ${m.title} → ${peopleNames.length} people`);
  }

  console.log('[backfill] done ✓');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
