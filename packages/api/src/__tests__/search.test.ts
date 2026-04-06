import { initTestDb, getDb, closeDb } from '../db/db';
import { SearchService } from '../services/search.service';

describe('SearchService', () => {
  let service: SearchService;

  beforeEach(() => {
    initTestDb();
    service = new SearchService();
  });
  afterEach(() => closeDb());

  it('indexes and searches records', () => {
    service.indexRecord('task', 1, 'Buy groceries', 'Need to buy milk and bread');
    service.indexRecord('task', 2, 'Fix bug', 'There is a critical bug in production');

    const results = service.search('groceries');
    expect(results.length).toBe(1);
    expect(results[0].ref_id).toBe(1);
  });

  it('removes records', () => {
    service.indexRecord('task', 1, 'Test task', 'Some body');
    service.removeRecord('task', 1);
    const results = service.search('Test');
    expect(results.length).toBe(0);
  });

  it('returns empty for empty query', () => {
    expect(service.search('')).toEqual([]);
  });
});
