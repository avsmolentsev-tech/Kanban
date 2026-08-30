import { queryOne } from '../db/db';
import type { AuthRequest } from './auth';
import { getUserId } from './user-scope';

export type PlanType = 'free' | 'pro_max';

export async function getUserPlan(userId: number): Promise<PlanType> {
  const row = await queryOne<{ plan: string }>('SELECT plan FROM users WHERE id = $1', [userId]);
  return (row?.plan as PlanType) || 'free';
}

const DAILY_LIMIT_FREE = 50;

export async function checkAiLimit(req: AuthRequest): Promise<{ allowed: boolean; used: number; limit: number | null }> {
  const userId = getUserId(req);
  if (!userId) return { allowed: false, used: 0, limit: 0 };

  const plan = await getUserPlan(userId);
  if (plan === 'pro_max') return { allowed: true, used: 0, limit: null };

  const today = new Date().toISOString().split('T')[0];
  const row = await queryOne<{ c: string }>(
    "SELECT COUNT(*) as c FROM usage_logs WHERE type = 'ai_chat' AND detail = $1 AND created_at >= $2",
    [`user:${userId}`, today]
  );
  const used = Number(row?.c ?? 0);
  return { allowed: used < DAILY_LIMIT_FREE, used, limit: DAILY_LIMIT_FREE };
}

export async function getAiUsageToday(userId: number): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  const row = await queryOne<{ c: string }>(
    "SELECT COUNT(*) as c FROM usage_logs WHERE type = 'ai_chat' AND detail = $1 AND created_at >= $2",
    [`user:${userId}`, today]
  );
  return Number(row?.c ?? 0);
}

export async function shouldUseFastTranscription(userId: number): Promise<boolean> {
  const plan = await getUserPlan(userId);
  return plan === 'pro_max';
}
