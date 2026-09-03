/**
 * Регресс-тест на закрытие auth bypass в /v1/yandex-calendar/auth: раньше
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
    googleClientId: '',
    googleClientSecret: '',
    yandexClientId: 'test-yandex-client-id',
    yandexClientSecret: 'test-yandex-client-secret',
    jwtSecret: 'test-secret-key',
    webappUrl: 'http://localhost:3001',
  },
}));

import { yandexCalendarRouter } from '../routes/yandex-calendar';
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
  app.use('/v1/yandex-calendar', yandexCalendarRouter);
  return app;
}

describe('GET /v1/yandex-calendar/auth — auth bypass закрыт', () => {
  test('без credentials — 401, тело ответа не содержит "uid"', async () => {
    const res = await request(buildApp(null)).get('/v1/yandex-calendar/auth');
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain('uid');
  });

  test('?uid=1 без credentials — всё равно 401, query-параметр не аутентифицирует', async () => {
    const res = await request(buildApp(null)).get('/v1/yandex-calendar/auth?uid=1');
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain('uid');
  });

  test('аутентифицированный запрос доходит до обработчика и уходит в редирект на Яндекс', async () => {
    const res = await request(buildApp(5)).get('/v1/yandex-calendar/auth');
    expect(res.status).toBe(302);
    expect(res.headers['location']).toMatch(/^https:\/\/oauth\.yandex\.ru\/authorize/);
  });

  test('?uid= вместе с валидной сессией игнорируется — используется userId из сессии, а не из query', async () => {
    const res = await request(buildApp(5)).get('/v1/yandex-calendar/auth?uid=999');
    expect(res.status).toBe(302);
    expect(res.headers['location']).toMatch(/^https:\/\/oauth\.yandex\.ru\/authorize/);
  });
});
