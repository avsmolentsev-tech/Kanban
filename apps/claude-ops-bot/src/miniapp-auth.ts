import * as crypto from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';

export function validateInitData(initData: string, botToken: string): { valid: boolean; userId?: number } {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return { valid: false };

    params.delete('hash');
    const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computed = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (computed !== hash) return { valid: false };

    const userStr = params.get('user');
    if (userStr) {
      const user = JSON.parse(userStr);
      return { valid: true, userId: user.id };
    }
    return { valid: true };
  } catch {
    return { valid: false };
  }
}

export function authHook(botToken: string, allowedTgId: number) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const initData = request.headers['x-telegram-init-data'] as string;
    if (!initData) {
      reply.code(401).send({ error: 'Missing initData' });
      return;
    }
    const { valid, userId } = validateInitData(initData, botToken);
    if (!valid || userId !== allowedTgId) {
      reply.code(403).send({ error: 'Invalid or unauthorized' });
      return;
    }
    (request as any).tgUserId = userId;
  };
}
