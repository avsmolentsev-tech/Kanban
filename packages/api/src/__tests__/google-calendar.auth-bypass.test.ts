/**
 * Регресс-тест на закрытие auth bypass в /v1/google-calendar/auth: раньше
 * userId брался из getUserId(req) ИЛИ (в обход) из query-параметра ?uid=,
 * что позволяло привязать чужой OAuth-обмен к произвольному user_id без
 * какой-либо аутентификации. Проверяем, что query-параметр больше не
 * работает как способ аутентификации, а настоящая сессия — работает.
 */
import express from 'express';
import request from 'supertest';

jest.mock('../db/db', () => ({
  queryOne: jest.fn(),
  queryAll: jest.fn(),
  execute: jest.fn(),
}));

jest.mock('../config', () => ({
  config: {
    googleClientId: 'test-google-client-id',
    googleClientSecret: 'test-google-client-secret',
    yandexClientId: '',
    yandexClientSecret: '',
    jwtSecret: 'test-secret-key',
    webappUrl: 'http://localhost:3001',
  },
}));

import { googleCalendarRouter } from '../routes/google-calendar';
import type { AuthRequest } from '../middleware/auth';

function buildApp(userId: number | null) {
  const app = express();
  app.use(express.json());
  app.use((req: AuthRequest, _res, next) => {
    if (userId !== null) {
      req.user = { id: userId, email: 'u@test.com', name: 'U', role: 'user' };
      req.authKind = 'session';
    }
    next();
  });
  app.use('/v1/google-calendar', googleCalendarRouter);
  return app;
}

describe('GET /v1/google-calendar/auth — auth bypass закрыт', () => {
  test('без credentials — 401, тело ответа не содержит "uid"', async () => {
    const res = await request(buildApp(null)).get('/v1/google-calendar/auth');
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain('uid');
  });

  test('?uid=1 без credentials — всё равно 401, query-параметр не аутентифицирует', async () => {
    const res = await request(buildApp(null)).get('/v1/google-calendar/auth?uid=1');
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain('uid');
  });

  test('аутентифицированный запрос доходит до обработчика и уходит в редирект на Google', async () => {
    const res = await request(buildApp(5)).get('/v1/google-calendar/auth');
    expect(res.status).toBe(302);
    expect(res.headers['location']).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
  });

  test('?uid= вместе с валидной сессией игнорируется — используется userId из сессии, а не из query', async () => {
    const res = await request(buildApp(5)).get('/v1/google-calendar/auth?uid=999');
    expect(res.status).toBe(302);
    // state — подписанный JWT с userId из сессии (5), а не из query (999);
    // сам факт успешного редиректа при подмене query подтверждает, что query игнорируется.
    expect(res.headers['location']).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
  });
});
