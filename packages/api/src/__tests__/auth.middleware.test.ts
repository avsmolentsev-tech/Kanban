/**
 * requireAuth должен требовать не просто truthy req.user, а числовой req.user.id.
 *
 * OAuth `state`-токены (google-calendar.ts, yandex-calendar.ts, todoist.ts) подписаны
 * тем же JWT_SECRET, но несут { userId } (а не { id }) и не имеют claim'а purpose.
 * Внутри своего 10-минутного времени жизни такой токен, отправленный как обычный
 * Bearer-заголовок, проходит через authMiddleware в JWT-ветку (payload.purpose !==
 * 'download' — true, потому что purpose вообще нет) и раньше проходил через
 * requireAuth тоже: там проверялось только `!req.user`, а объект `{ userId: 5 }`
 * truthy. req.user.id при этом оставался undefined, поэтому getUserId(req) всё
 * равно возвращал null и утечки данных не было — но сам факт, что "не тот" тип
 * токена проходит гейт аутентификации, для демо с ревью безопасности неприемлем.
 */
import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { requireAuth, AuthRequest, authMiddleware } from '../middleware/auth';
import { config } from '../config';

function makeReq(headers: Record<string, string> = {}): AuthRequest {
  return { headers, query: {} } as unknown as AuthRequest;
}

function makeRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

describe('requireAuth — требует числовой id, а не просто truthy req.user', () => {
  test('req.user без числового id (форма OAuth state-токена) — 401, next() не вызывается', () => {
    const req = makeReq();
    (req as AuthRequest).user = { userId: 5 } as unknown as AuthRequest['user'];
    const res = makeRes();
    const next = jest.fn();
    requireAuth(req, res, next as NextFunction);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('req.user с числовым id — пропускает, next() вызывается', () => {
    const req = makeReq();
    (req as AuthRequest).user = { id: 5, email: 'a@b.com', name: 'A', role: 'user' };
    const res = makeRes();
    const next = jest.fn();
    requireAuth(req, res, next as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('req.user отсутствует — 401, как и раньше', () => {
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();
    requireAuth(req, res, next as NextFunction);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('интеграция: OAuth state-токен ({ userId }, без purpose), отправленный как Bearer, не проходит requireAuth', async () => {
    const stateToken = jwt.sign({ userId: 5 }, config.jwtSecret, { expiresIn: '10m' });
    const req = makeReq({ authorization: `Bearer ${stateToken}` });
    const authNext = jest.fn();
    await authMiddleware(req, makeRes(), authNext as NextFunction);
    expect(authNext).toHaveBeenCalledTimes(1);
    // authMiddleware кладёт payload как есть — id в нём нет, только userId.
    expect((req.user as unknown as { userId?: number })?.userId).toBe(5);

    const res = makeRes();
    const guardNext = jest.fn();
    requireAuth(req, res, guardNext as NextFunction);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(guardNext).not.toHaveBeenCalled();
  });

  test('интеграция: полноценная сессия (id — number) по-прежнему проходит requireAuth', async () => {
    const sessionToken = jwt.sign({ id: 7, email: 'a@b.com', name: 'A', role: 'user' }, config.jwtSecret);
    const req = makeReq({ authorization: `Bearer ${sessionToken}` });
    await authMiddleware(req, makeRes(), jest.fn() as unknown as NextFunction);

    const res = makeRes();
    const guardNext = jest.fn();
    requireAuth(req, res, guardNext as NextFunction);
    expect(guardNext).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
