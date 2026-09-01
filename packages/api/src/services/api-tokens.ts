import * as crypto from 'crypto';
import { queryOne, queryAll, execute } from '../db/db';

const PREFIX = 'cs_';

function hash(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export interface ApiTokenListItem {
  id: number;
  name: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

/** Токен показывается пользователю один раз; в базе живёт только SHA-256. */
export async function issueToken(
  userId: number,
  name: string,
  ttlDays: number | null
): Promise<{ token: string; id: number }> {
  const token = PREFIX + crypto.randomBytes(24).toString('base64url');
  const row = await queryOne<{ id: number }>(
    `INSERT INTO api_tokens (user_id, name, token_hash, expires_at)
     VALUES ($1, $2, $3, CASE WHEN $4::int IS NULL THEN NULL ELSE now() + ($4 || ' days')::interval END)
     RETURNING id`,
    [userId, name, hash(token), ttlDays]
  );
  return { token, id: row!.id };
}

/** Проверка по хешу — единственный путь опознать токен, сырая строка ни с чем не сравнивается. */
export async function verifyToken(raw: string): Promise<{ userId: number; tokenId: number } | null> {
  const row = await queryOne<{ id: number; user_id: number }>(
    `SELECT id, user_id FROM api_tokens
     WHERE token_hash = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
    [hash(raw)]
  );
  if (!row) return null;
  await execute(`UPDATE api_tokens SET last_used_at = now() WHERE id = $1`, [row.id]);
  return { userId: row.user_id, tokenId: row.id };
}

/** Отзыв — только владелец токена может его отозвать; чужой id молча не находит строк. */
export async function revokeToken(userId: number, tokenId: number): Promise<boolean> {
  const n = await execute(
    `UPDATE api_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [tokenId, userId]
  );
  return n > 0;
}

export async function listTokens(userId: number): Promise<ApiTokenListItem[]> {
  return await queryAll<ApiTokenListItem>(
    `SELECT id, name, created_at, expires_at, revoked_at
     FROM api_tokens WHERE user_id = $1 ORDER BY id DESC`,
    [userId]
  );
}
