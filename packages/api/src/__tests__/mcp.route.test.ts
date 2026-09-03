/**
 * HTTP-слой POST /mcp: та же проводка (authMiddleware → requireAuth → handleMcp
 * → JSON-RPC parse-error middleware), что смонтирована в src/index.ts, — здесь
 * воспроизведена в отдельном тестовом Express-приложении, потому что реальный
 * index.ts запускает настоящее подключение к Postgres при импорте (start()).
 * services/api-tokens замокан: проверяем маршрутизацию и авторизацию, а не
 * хеширование токенов (это покрыто api-tokens.test.ts).
 */
import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';

jest.mock('../db/db', () => ({
  query: jest.fn(),
  queryAll: jest.fn(),
  queryOne: jest.fn(),
  execute: jest.fn(),
}));
jest.mock('../services/api-tokens', () => ({ verifyToken: jest.fn() }));
jest.mock('../services/obsidian.service', () => ({
  ObsidianService: jest.fn().mockImplementation(() => ({
    forUser: jest.fn().mockReturnValue({ writeTask: jest.fn().mockResolvedValue('Tasks/x.md'), updateTask: jest.fn() }),
  })),
}));
jest.mock('../services/search.service', () => ({ searchService: { indexRecord: jest.fn(), removeRecord: jest.fn() } }));

import { queryAll, queryOne } from '../db/db';
import { verifyToken } from '../services/api-tokens';
import { authMiddleware, requireAuth, AuthRequest } from '../middleware/auth';
import { getUserId } from '../middleware/user-scope';
import { handleMcp } from '../routes/mcp';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.post('/mcp', requireAuth, async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req);
    if (userId == null) {
      res.status(401).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Authentication required' } });
      return;
    }
    const result = await handleMcp(req.body, userId);
    res.json(result);
  });
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    const isBodyParseError = err && typeof err === 'object' && 'type' in err && (err as { type?: string }).type === 'entity.parse.failed';
    if (isBodyParseError && req.path === '/mcp') {
      res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error: invalid JSON' } });
      return;
    }
    next(err);
  });
  return app;
}

const queryAllMock = queryAll as jest.Mock;
const queryOneMock = queryOne as jest.Mock;
const verifyTokenMock = verifyToken as jest.Mock;

describe('POST /mcp — авторизация', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queryAllMock.mockResolvedValue([]);
    queryOneMock.mockResolvedValue(null);
  });

  test('без заголовка Authorization — 401, handleMcp не вызывается (БД не трогается)', async () => {
    const res = await request(buildApp()).post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(res.status).toBe(401);
    expect(verifyTokenMock).not.toHaveBeenCalled();
    expect(queryOneMock).not.toHaveBeenCalled();
    expect(queryAllMock).not.toHaveBeenCalled();
  });

  test('с невалидным/отозванным cs_-токеном — 401', async () => {
    verifyTokenMock.mockResolvedValue(null);
    const res = await request(buildApp())
      .post('/mcp')
      .set('Authorization', 'Bearer cs_revoked')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(res.status).toBe(401);
  });

  test('с валидным cs_-токеном — 200 и корректный JSON-RPC ответ', async () => {
    verifyTokenMock.mockResolvedValue({ userId: 5, tokenId: 1 });
    const res = await request(buildApp())
      .post('/mcp')
      .set('Authorization', 'Bearer cs_valid')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(res.status).toBe(200);
    expect(res.body.result.serverInfo.name).toBe('clarity-space');
  });

  test('синтаксически невалидный JSON в теле — 400 с JSON-RPC parse error, не HTML-страница', async () => {
    verifyTokenMock.mockResolvedValue({ userId: 5, tokenId: 1 });
    const res = await request(buildApp())
      .post('/mcp')
      .set('Authorization', 'Bearer cs_valid')
      .set('Content-Type', 'application/json')
      .send('{ this is not json');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(-32700);
  });

  test('токен пользователя A видит только свои задачи, токен пользователя B — только свои', async () => {
    queryAllMock.mockImplementation(async (_sql: string, params: unknown[]) => {
      const userId = params[0];
      return userId === 5 ? [{ id: 100, title: 'Задача A', user_id: 5 }] : [{ id: 200, title: 'Задача B', user_id: 7 }];
    });

    verifyTokenMock.mockResolvedValueOnce({ userId: 5, tokenId: 1 });
    const resA = await request(buildApp())
      .post('/mcp')
      .set('Authorization', 'Bearer cs_userA')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_tasks', arguments: {} } });
    const tasksA = JSON.parse(resA.body.result.content[0].text);
    expect(tasksA).toHaveLength(1);
    expect(tasksA[0].user_id).toBe(5);

    verifyTokenMock.mockResolvedValueOnce({ userId: 7, tokenId: 2 });
    const resB = await request(buildApp())
      .post('/mcp')
      .set('Authorization', 'Bearer cs_userB')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_tasks', arguments: {} } });
    const tasksB = JSON.parse(resB.body.result.content[0].text);
    expect(tasksB).toHaveLength(1);
    expect(tasksB[0].user_id).toBe(7);

    // Пользователь A ни разу не увидел задачу B и наоборот.
    expect(tasksA.some((t: any) => t.user_id === 7)).toBe(false);
    expect(tasksB.some((t: any) => t.user_id === 5)).toBe(false);
  });

  test('обычный JWT-сессионный токен тоже допускается (MCP не требует именно cs_)', async () => {
    const jwt = require('jsonwebtoken');
    const { config } = require('../config');
    const token = jwt.sign({ id: 3, email: 'a@b.com', name: 'A', role: 'user' }, config.jwtSecret);
    const res = await request(buildApp())
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(res.status).toBe(200);
    expect(verifyTokenMock).not.toHaveBeenCalled();
  });
});
