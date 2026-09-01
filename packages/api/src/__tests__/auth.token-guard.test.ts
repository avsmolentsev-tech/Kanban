/**
 * Интеграционная проверка на уровне роутов: маршруты, выдающие новую сессию или
 * меняющие состояние аккаунта (GET/PATCH /auth/me, POST /auth/plan), должны
 * отклонять аутентификацию по служебному API-токену (req.authKind === 'api-token'),
 * даже когда req.user заполнен. Реальный authMiddleware не участвует — req.user /
 * req.authKind проставляются напрямую, как их проставил бы authMiddleware.
 */
import express from 'express';
import request from 'supertest';

jest.mock('../db/db', () => ({
  queryAll: jest.fn(),
  queryOne: jest.fn(),
  execute: jest.fn(),
}));
jest.mock('../middleware/plan', () => ({
  getUserPlan: jest.fn().mockResolvedValue('free'),
  getAiUsageToday: jest.fn().mockResolvedValue(0),
}));
jest.mock('../services/email.service', () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
  generateCode: jest.fn().mockReturnValue('123456'),
}));

import { queryOne, execute } from '../db/db';
import { authRouter } from '../routes/auth';
import type { AuthRequest } from '../middleware/auth';

function buildApp(authKind: 'session' | 'api-token' | undefined, userId = 5) {
  const app = express();
  app.use(express.json());
  app.use((req: AuthRequest, _res, next) => {
    if (authKind) {
      req.user = { id: userId, email: 'u@test.com', name: 'U', role: 'user' };
      req.authKind = authKind;
    }
    next();
  });
  app.use('/v1/auth', authRouter);
  return app;
}

describe('routes/auth — guard denyApiTokenAuth на маршрутах, меняющих состояние аккаунта', () => {
  beforeEach(() => jest.clearAllMocks());

  test('PATCH /auth/me по API-токену — 403, пароль/имя не переписываются', async () => {
    const app = buildApp('api-token');
    const res = await request(app).patch('/v1/auth/me').send({ password: 'newpassword123' });
    expect(res.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });

  test('PATCH /auth/me по сессии (JWT) продолжает работать как раньше', async () => {
    (execute as jest.Mock).mockResolvedValue(1);
    (queryOne as jest.Mock).mockResolvedValue({
      id: 5, email: 'u@test.com', name: 'New Name', password_hash: 'x', role: 'user', plan: 'free', created_at: 'now',
    });
    const app = buildApp('session');
    const res = await request(app).patch('/v1/auth/me').send({ name: 'New Name' });
    expect(res.status).toBe(200);
    expect(execute).toHaveBeenCalled();
  });

  test('POST /auth/plan по API-токену — 403, план не меняется', async () => {
    const app = buildApp('api-token');
    const res = await request(app).post('/v1/auth/plan').send({ plan: 'pro_max' });
    expect(res.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });

  test('GET /auth/me по API-токену — 403, не отдаёт профиль с пустыми email/name', async () => {
    const app = buildApp('api-token');
    const res = await request(app).get('/v1/auth/me');
    expect(res.status).toBe(403);
  });

  test('GET /auth/me по сессии продолжает работать как раньше', async () => {
    const app = buildApp('session');
    const res = await request(app).get('/v1/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('u@test.com');
  });
});
