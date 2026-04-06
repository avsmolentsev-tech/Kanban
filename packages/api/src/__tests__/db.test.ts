import { initTestDb, getDb, closeDb } from '../db/db';

describe('database', () => {
  beforeEach(() => initTestDb());
  afterEach(() => closeDb());

  it('creates all tables', () => {
    const db = getDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain('projects');
    expect(names).toContain('tasks');
    expect(names).toContain('people');
    expect(names).toContain('meetings');
    expect(names).toContain('agreements');
    expect(names).toContain('ideas');
    expect(names).toContain('inbox_items');
  });
});
