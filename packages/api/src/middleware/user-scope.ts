import type { AuthRequest } from './auth';

export function getUserId(req: AuthRequest): number | null {
  return req.user?.id ?? null;
}

/**
 * Returns SQL WHERE clause fragment scoped strictly to the current user.
 * Never matches NULL user_id rows — they belong to no one and must not leak.
 */
export function userScopeWhere(req: AuthRequest): { sql: string; params: unknown[] } {
  const userId = getUserId(req);
  if (userId === null) {
    return { sql: '1=0', params: [] };
  }
  return { sql: 'user_id = ?', params: [userId] };
}
