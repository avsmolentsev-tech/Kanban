/**
 * Ветка Bearer cs_... в authMiddleware: не должна ослаблять существующий JWT-путь
 * и не должна аутентифицировать запросы, которые раньше проходили анонимно.
 */
import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

jest.mock('../services/api-tokens', () => ({ verifyToken: jest.fn() }));
import { verifyToken } from '../services/api-tokens';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { config } from '../config';

function makeReq(headers: Record<string, string> = {}): AuthRequest {
  return { headers, query: {} } as unknown as AuthRequest;
}

const res = {} as Response;

describe('authMiddleware — ветка API-токенов', () => {
  beforeEach(() => jest.clearAllMocks());

  test('валидный cs_-токен кладёт userId в req.user с минимальной ролью', async () => {
    (verifyToken as jest.Mock).mockResolvedValue({ userId: 5, tokenId: 9 });
    const req = makeReq({ authorization: 'Bearer cs_validtoken' });
    const next = jest.fn();
    await authMiddleware(req, res, next as NextFunction);
    expect(req.user).toEqual({ id: 5, email: '', name: '', role: 'user' });
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
});
