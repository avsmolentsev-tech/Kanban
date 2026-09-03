import { issueToken, verifyToken, revokeToken, listTokens } from '../services/api-tokens';
import * as crypto from 'crypto';

jest.mock('../db/db', () => ({ queryOne: jest.fn(), queryAll: jest.fn(), execute: jest.fn() }));
import { queryOne, queryAll, execute } from '../db/db';

/** Схлопывает пробелы/переносы строк — сравниваем текст запроса, а не форматирование. */
function norm(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

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

  test('issueToken с ttlDays = null пишет NULL в expires_at и передаёт null четвёртым параметром', async () => {
    (queryOne as jest.Mock).mockResolvedValue({ id: 1 });
    await issueToken(5, 'CI', null);
    const [sql, params] = (queryOne as jest.Mock).mock.calls[0];
    expect(norm(sql)).toBe(norm(
      `INSERT INTO api_tokens (user_id, name, token_hash, expires_at)
       VALUES ($1, $2, $3, CASE WHEN $4::int IS NULL THEN NULL ELSE now() + ($4 || ' days')::interval END)
       RETURNING id`
    ));
    expect(params[3]).toBeNull();
  });

  test('issueToken с ttlDays = 30 передаёт число четвёртым параметром в тот же запрос', async () => {
    (queryOne as jest.Mock).mockResolvedValue({ id: 2 });
    const { id } = await issueToken(5, 'CI-30d', 30);
    const [sql, params] = (queryOne as jest.Mock).mock.calls[0];
    expect(norm(sql)).toBe(norm(
      `INSERT INTO api_tokens (user_id, name, token_hash, expires_at)
       VALUES ($1, $2, $3, CASE WHEN $4::int IS NULL THEN NULL ELSE now() + ($4 || ' days')::interval END)
       RETURNING id`
    ));
    expect(params).toEqual([5, 'CI-30d', expect.any(String), 30]);
    expect(id).toBe(2);
  });

  test('валидный токен опознаётся по хешу — запрос закреплён дословно (скобки вокруг OR обязательны)', async () => {
    (queryOne as jest.Mock).mockResolvedValue({ id: 9, user_id: 5 });
    (execute as jest.Mock).mockResolvedValue(1);
    const r = await verifyToken('cs_abc');
    expect(r).toEqual({ userId: 5, tokenId: 9 });
    const [sql, params] = (queryOne as jest.Mock).mock.calls[0];
    expect(norm(sql)).toBe(norm(
      `SELECT id, user_id FROM api_tokens
       WHERE token_hash = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`
    ));
    expect(params).toEqual([crypto.createHash('sha256').update('cs_abc').digest('hex')]);
  });

  test('неизвестный токен отклоняется', async () => {
    (queryOne as jest.Mock).mockResolvedValue(null);
    expect(await verifyToken('cs_нет')).toBeNull();
  });

  test('падение записи last_used_at не мешает опознать валидный токен', async () => {
    (queryOne as jest.Mock).mockResolvedValue({ id: 9, user_id: 5 });
    (execute as jest.Mock).mockRejectedValue(new Error('statement timeout'));
    const r = await verifyToken('cs_abc');
    expect(r).toEqual({ userId: 5, tokenId: 9 });
  });

  test('неизвестный токен не запускает запись last_used_at', async () => {
    (queryOne as jest.Mock).mockResolvedValue(null);
    await verifyToken('cs_нет');
    expect(execute).not.toHaveBeenCalled();
  });

  test('отзыв проставляет revoked_at только своему токену — запрос закреплён дословно', async () => {
    (execute as jest.Mock).mockResolvedValue(1);
    expect(await revokeToken(5, 9)).toBe(true);
    const [sql, params] = (execute as jest.Mock).mock.calls[0];
    expect(norm(sql)).toBe(norm(
      `UPDATE api_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`
    ));
    expect(params).toEqual([9, 5]);
  });

  test('отзыв чужого/несуществующего токена возвращает false', async () => {
    (execute as jest.Mock).mockResolvedValue(0);
    expect(await revokeToken(5, 999)).toBe(false);
  });

  test('listTokens возвращает токены только своего пользователя, без значений токенов', async () => {
    const rows = [
      { id: 2, name: 'CI', created_at: 'x', expires_at: null, revoked_at: null },
      { id: 1, name: 'Bot', created_at: 'y', expires_at: null, revoked_at: null },
    ];
    (queryAll as jest.Mock).mockResolvedValue(rows);
    const result = await listTokens(5);
    expect(result).toBe(rows);
    const [sql, params] = (queryAll as jest.Mock).mock.calls[0];
    expect(norm(sql)).toBe(norm(
      `SELECT id, name, created_at, expires_at, revoked_at
       FROM api_tokens WHERE user_id = $1 ORDER BY id DESC`
    ));
    expect(params).toEqual([5]);
    expect(result.every(r => !('token' in r) && !('token_hash' in r))).toBe(true);
  });
});
