/**
 * Ветка Bearer cs_... в authMiddleware: не должна ослаблять существующий JWT-путь
 * и не должна аутентифицировать запросы, которые раньше проходили анонимно.
 */
import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

jest.mock('../services/api-tokens', () => ({ verifyToken: jest.fn() }));
import { verifyToken } from '../services/api-tokens';
import { authMiddleware, denyApiTokenAuth, AuthRequest } from '../middleware/auth';
import { config } from '../config';

function makeReq(headers: Record<string, string> = {}, query: Record<string, string> = {}): AuthRequest {
  return { headers, query } as unknown as AuthRequest;
}

const res = {} as Response;

describe('authMiddleware — ветка API-токенов', () => {
  beforeEach(() => jest.clearAllMocks());

  test('валидный cs_-токен кладёт userId в req.user с минимальной ролью и помечает authKind', async () => {
    (verifyToken as jest.Mock).mockResolvedValue({ userId: 5, tokenId: 9 });
    const req = makeReq({ authorization: 'Bearer cs_validtoken' });
    const next = jest.fn();
    await authMiddleware(req, res, next as NextFunction);
    expect(req.user).toEqual({ id: 5, email: '', name: '', role: 'user' });
    expect(req.authKind).toBe('api-token');
    expect(req.tokenId).toBe(9);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('отозванный/просроченный cs_-токен (verifyToken → null) не аутентифицирует', async () => {
    (verifyToken as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ authorization: 'Bearer cs_revoked' });
    const next = jest.fn();
    await authMiddleware(req, res, next as NextFunction);
    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('ошибка при проверке cs_-токена не роняет запрос и не аутентифицирует', async () => {
    (verifyToken as jest.Mock).mockRejectedValue(new Error('db down'));
    const req = makeReq({ authorization: 'Bearer cs_whatever' });
    const next = jest.fn();
    await authMiddleware(req, res, next as NextFunction);
    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('валидный JWT продолжает работать как раньше (не задет веткой cs_)', async () => {
    const token = jwt.sign({ id: 1, email: 'a@b.com', name: 'A', role: 'admin' }, config.jwtSecret);
    const req = makeReq({ authorization: `Bearer ${token}` });
    const next = jest.fn();
    await authMiddleware(req, res, next as NextFunction);
    expect(req.user).toMatchObject({ id: 1, email: 'a@b.com', name: 'A', role: 'admin' });
    expect(req.authKind).toBe('session');
    expect(verifyToken).not.toHaveBeenCalled();
  });

  test('запрос без заголовка Authorization остаётся анонимным (как раньше)', async () => {
    const req = makeReq({});
    const next = jest.fn();
    await authMiddleware(req, res, next as NextFunction);
    expect(req.user).toBeUndefined();
    expect(verifyToken).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('невалидный JWT-мусор без cs_-префикса остаётся анонимным', async () => {
    const req = makeReq({ authorization: 'Bearer garbage.not.a.jwt' });
    const next = jest.fn();
    await authMiddleware(req, res, next as NextFunction);
    expect(req.user).toBeUndefined();
    expect(verifyToken).not.toHaveBeenCalled();
  });

  test('?token=cs_... в query-параметре остаётся анонимным — API-токены принимаются только из заголовка', async () => {
    const req = makeReq({}, { token: 'cs_leaked-in-url' });
    const next = jest.fn();
    await authMiddleware(req, res, next as NextFunction);
    expect(req.user).toBeUndefined();
    expect(req.authKind).toBeUndefined();
    expect(verifyToken).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('?token=<JWT> в query-параметре продолжает работать (регрессия для скачивания по ссылке)', async () => {
    const token = jwt.sign({ id: 1, email: 'a@b.com', name: 'A', role: 'user', purpose: 'download' }, config.jwtSecret);
    const req = makeReq({}, { token });
    const next = jest.fn();
    await authMiddleware(req, res, next as NextFunction);
    // purpose: 'download' — не сессия, но и не отклонена как cs_-токен из query
    expect(req.user).toBeUndefined();
    expect(verifyToken).not.toHaveBeenCalled();
  });
});

describe('denyApiTokenAuth', () => {
  test('запрос по API-токену получает 403 с русским сообщением, next не вызывается', () => {
    const req = { authKind: 'api-token' } as unknown as AuthRequest;
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const res2 = { status } as unknown as Response;
    const next = jest.fn();
    denyApiTokenAuth(req, res2, next as NextFunction);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(next).not.toHaveBeenCalled();
  });

  test('сессия (authKind = session) проходит дальше', () => {
    const req = { authKind: 'session' } as unknown as AuthRequest;
    const next = jest.fn();
    denyApiTokenAuth(req, {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('анонимный запрос (authKind не задан) проходит дальше — его отклонит requireAuth раньше по цепочке', () => {
    const req = {} as unknown as AuthRequest;
    const next = jest.fn();
    denyApiTokenAuth(req, {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
