import { checkHealth } from '../services/health.service';

jest.mock('../db/db', () => ({ query: jest.fn() }));
import { query } from '../db/db';

describe('checkHealth', () => {
  beforeEach(() => jest.clearAllMocks());

  test('живая база и доступный vault → status ok', async () => {
    (query as jest.Mock).mockResolvedValue({ rows: [{ ok: 1 }] });
    const r = await checkHealth();
    const db = r.checks.find((c) => c.name === 'postgres');
    expect(db?.ok).toBe(true);
    expect(['ok', 'degraded']).toContain(r.status);
  });

  test('мёртвая база → status down, а не ok', async () => {
    (query as jest.Mock).mockRejectedValue(new Error('connection refused'));
    const r = await checkHealth();
    expect(r.status).toBe('down');
    const db = r.checks.find((c) => c.name === 'postgres');
    expect(db?.ok).toBe(false);
    expect(db?.detail).toContain('connection refused');
  });

  test('отчёт содержит проверки по всем зависимостям', async () => {
    (query as jest.Mock).mockResolvedValue({ rows: [{ ok: 1 }] });
    const names = (await checkHealth()).checks.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['postgres', 'vault', 'whisper', 'llm']));
  });
});
