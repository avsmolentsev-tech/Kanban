import { Router, Response } from 'express';
import { z } from 'zod';
import { ok, fail } from '@pis/shared';
import type { AuthRequest } from '../middleware/auth';
import { denyApiTokenAuth } from '../middleware/auth';
import { getUserId } from '../middleware/user-scope';
import { issueToken, listTokens, revokeToken } from '../services/api-tokens';

export const apiTokensRouter = Router();

// Управление токенами доступно только полноценной сессии (логин по паролю).
// Иначе один API-токен мог бы выпускать себе замену без ограничения по сроку —
// отзыв одного токена не отзывает другие, выпущенные им ранее.
apiTokensRouter.use(denyApiTokenAuth);

const CreateSchema = z.object({
  name: z.string().min(1),
  ttlDays: z.number().int().positive().nullable().optional(),
});

// Выпуск нового служебного токена. Сырой токен возвращается только в этом
// ответе и никогда больше не может быть прочитан — в базе живёт лишь хеш.
apiTokensRouter.post('/', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json(fail('Auth required')); return; }

  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(fail(parsed.error.message));
    return;
  }
  const { name, ttlDays } = parsed.data;
  const { token, id } = await issueToken(userId, name, ttlDays ?? null);
  res.status(201).json(ok({ id, token, name }));
});

// Список собственных токенов пользователя, без значений токенов.
apiTokensRouter.get('/', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json(fail('Auth required')); return; }

  const tokens = await listTokens(userId);
  res.json(ok(tokens));
});

// Отзыв — только владельцу. Чужой id токена не находит строк и возвращает 404.
apiTokensRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json(fail('Auth required')); return; }

  const tokenId = Number(req.params['id']);
  if (!Number.isInteger(tokenId)) { res.status(400).json(fail('Invalid token id')); return; }

  const revoked = await revokeToken(userId, tokenId);
  if (!revoked) { res.status(404).json(fail('Token not found')); return; }
  res.json(ok({ revoked: true }));
});
