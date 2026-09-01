/**
 * HTTP-слой роута /v1/api-tokens: собственность токена и форма ответа.
 * Сервис api-tokens замокан — здесь проверяется маршрутизация и проверка владельца,
 * а не поведение хеширования (это покрыто api-tokens.test.ts).
 */
import express from 'express';
import request from 'supertest';

jest.mock('../services/api-tokens', () => ({
  issueToken: jest.fn(),
  listTokens: jest.fn(),
  revokeToken: jest.fn(),
}));
import { issueToken, listTokens, revokeToken } from '../services/api-tokens';
import { apiTokensRouter } from '../routes/api-tokens';
import type { AuthRequest } from '../middleware/auth';

function buildApp(userId: number | null) {
  const app = express();
  app.use(express.json());
  app.use((req: AuthRequest, _res, next) => {
    if (userId !== null) {
      req.user = { id: userId, email: 'u@test.com', name: 'U', role: 'user' };
    }
    next();
  });
  app.use('/v1/api-tokens', apiTokensRouter);
  return app;
}

describe('роут /v1/api-tokens', () => {
  beforeEach(() => jest.clearAllMocks());

  test('POST / возвращает токен один раз в теле ответа создания', async () => {
    (issueToken as jest.Mock).mockResolvedValue({ token: 'cs_raw-value', id: 7 });
    const res = await request(buildApp(5)).post('/v1/api-tokens').send({ name: 'CI' });
    expect(res.status).toBe(201);
    expect(res.body.data.token).toBe('cs_raw-value');
    expect(issueToken).toHaveBeenCalledWith(5, 'CI', null);
  });

  test('GET / не содержит поля token в ответе', async () => {
    (listTokens as jest.Mock).mockResolvedValue([
      { id: 1, name: 'CI', created_at: 'x', expires_at: null, revoked_at: null },
    ]);
    const res = await request(buildApp(5)).get('/v1/api-tokens');
    expect(res.status).toBe(200);
    expect(res.body.data[0]).not.toHaveProperty('token');
    expect(listTokens).toHaveBeenCalledWith(5);
  });

  test('DELETE /:id передаёт userId и id из URL — чужой токен отозвать нельзя', async () => {
    (revokeToken as jest.Mock).mockResolvedValue(false);
    const res = await request(buildApp(5)).delete('/v1/api-tokens/999');
    expect(res.status).toBe(404);
    expect(revokeToken).toHaveBeenCalledWith(5, 999);
  });

  test('DELETE /:id при успешном отзыве своего токена возвращает 200', async () => {
    (revokeToken as jest.Mock).mockResolvedValue(true);
    const res = await request(buildApp(5)).delete('/v1/api-tokens/9');
    expect(res.status).toBe(200);
    expect(revokeToken).toHaveBeenCalledWith(5, 9);
  });

  test('без аутентифицированного пользователя — 401, сервис не вызывается', async () => {
    const res = await request(buildApp(null)).get('/v1/api-tokens');
    expect(res.status).toBe(401);
    expect(listTokens).not.toHaveBeenCalled();
  });

  test('нечисловой id в DELETE — 400, сервис не вызывается', async () => {
    const res = await request(buildApp(5)).delete('/v1/api-tokens/not-a-number');
    expect(res.status).toBe(400);
    expect(revokeToken).not.toHaveBeenCalled();
  });
});
