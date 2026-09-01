import { issueToken, verifyToken, revokeToken } from '../services/api-tokens';
import * as crypto from 'crypto';

jest.mock('../db/db', () => ({ queryOne: jest.fn(), queryAll: jest.fn(), execute: jest.fn() }));
import { queryOne, execute } from '../db/db';

describe('API-токены', () => {
  beforeEach(() => jest.clearAllMocks());

  test('в базу пишется только хеш, не сам токен', async () => {
    (queryOne as jest.Mock).mockResolvedValue({ id: 1 });
    const { token } = await issueToken(5, 'CI', null);
    const [, params] = (queryOne as jest.Mock).mock.calls[0];
    expect(params).not.toContain(token);
    expect(params[2]).toBe(crypto.createHash('sha256').update(token).digest('hex'));
  });

  test('токен имеет узнаваемый префикс и достаточную длину', async () => {
    (queryOne as jest.Mock).mockResolvedValue({ id: 1 });
    const { token } = await issueToken(5, 'CI', null);
    expect(token.startsWith('cs_')).toBe(true);
    expect(token.length).toBeGreaterThanOrEqual(35);
  });

  test('валидный токен опознаётся по хешу', async () => {
    (queryOne as jest.Mock).mockResolvedValue({ id: 9, user_id: 5 });
    (execute as jest.Mock).mockResolvedValue(1);
    const r = await verifyToken('cs_abc');
    expect(r).toEqual({ userId: 5, tokenId: 9 });
    const [sql] = (queryOne as jest.Mock).mock.calls[0];
    expect(sql).toContain('revoked_at IS NULL');
    expect(sql).toContain('expires_at IS NULL OR expires_at > now()');
  });

  test('неизвестный токен отклоняется', async () => {
    (queryOne as jest.Mock).mockResolvedValue(null);
    expect(await verifyToken('cs_нет')).toBeNull();
  });

  test('отзыв проставляет revoked_at только своему токену', async () => {
    (execute as jest.Mock).mockResolvedValue(1);
    expect(await revokeToken(5, 9)).toBe(true);
    const [sql, params] = (execute as jest.Mock).mock.calls[0];
    expect(sql).toContain('SET revoked_at = now()');
    expect(params).toEqual([9, 5]);
  });
});
