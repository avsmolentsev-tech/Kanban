import type { AuthRequest } from './auth';

/**
 * Returns the user_id from the request, or null if not authenticated.
 * Used in routes to scope data queries to the current user.
 */
export function getUserId(req: AuthRequest): number | null {
  return req.user?.id ?? null;
}

/**
 * Returns SQL WHERE clause fragment for user scoping.
 * If user is authenticated: "user_id = ?" or "(user_id = ? OR user_id IS NULL)" for backwards compat
 * If not authenticated: "1=1" (no filter — legacy single-user mode)
 */
export function userScopeWhere(req: AuthRequest, opts?: { includeNull?: boolean }): { sql: string; params: unknown[] } {
  const userId = getUserId(req);
  if (userId === null) {
    return { sql: '1=1', params: [] };
  }
  if (opts?.includeNull) {
    return { sql: '(user_id = ? OR user_id IS NULL)', params: [userId] };
  }
  return { sql: '(user_id = ? OR user_id IS NULL)', params: [userId] };
}
