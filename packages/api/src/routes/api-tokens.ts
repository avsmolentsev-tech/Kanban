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
  try {
    const { token, id } = await issueToken(userId, name, ttlDays ?? null);
    res.status(201).json(ok({ id, token, name }));
  } catch (err) {
    // Без try/catch отклонённый промис (например, недоступна таблица api_tokens
    // из-за неприменённой миграции — см. CLAUDE.md B2) уходил бы в Express 4 как
    // необработанное исключение: ответа не будет вообще, клиент повиснет вместо 500.
    res.status(500).json(fail(err instanceof Error ? err.message : 'Token issue error'));
  }
});

// Список собственных токенов пользователя, без значений токенов.
apiTokensRouter.get('/', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json(fail('Auth required')); return; }

  try {
    const tokens = await listTokens(userId);
    res.json(ok(tokens));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Token list error'));
  }
});

// Отзыв — только владельцу. Чужой id токена не находит строк и возвращает 404.
apiTokensRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json(fail('Auth required')); return; }

  const tokenId = Number(req.params['id']);
  if (!Number.isInteger(tokenId)) { res.status(400).json(fail('Invalid token id')); return; }

  try {
    const revoked = await revokeToken(userId, tokenId);
    if (!revoked) { res.status(404).json(fail('Token not found')); return; }
    res.json(ok({ revoked: true }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Token revoke error'));
  }
});
