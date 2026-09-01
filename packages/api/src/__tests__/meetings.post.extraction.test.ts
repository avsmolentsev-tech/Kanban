/**
 * POST /v1/meetings — извлечение обязательств (commitments) из summary_raw
 * при создании встречи через API.
 *
 * До этого изменения searchService.extractTasksFromMeeting вызывался ТОЛЬКО из
 * syncMeetingFromVault (см. search.service.ts) — встречи, созданные через API
 * с готовым транскриптом в summary_raw, никогда не порождали задачи-обязательства
 * для экрана /v1/commitments. db/obsidian замокан, чтобы проверять маршрутизацию
 * и условие запуска извлечения, а не поведение самого extractTasksFromMeeting
 * (оно покрыто отдельно — claude-extraction.test.ts и логикой search.service).
 */
import express from 'express';
import request from 'supertest';

jest.mock('../db/db', () => ({
  query: jest.fn(),
  queryAll: jest.fn(),
  queryOne: jest.fn(),
  execute: jest.fn(),
}));
jest.mock('../services/obsidian.service', () => ({
  ObsidianService: jest.fn().mockImplementation(() => ({
    forUser: jest.fn().mockReturnValue({ writeMeeting: jest.fn().mockResolvedValue('Meetings/x.md'), deleteFile: jest.fn() }),
  })),
}));
jest.mock('../services/claude.service', () => ({
  ClaudeService: jest.fn().mockImplementation(() => ({})),
  PII_TOKEN_NOTE: '',
}));
jest.mock('../services/telegram.service', () => ({ telegramService: {} }));
jest.mock('../services/search.service', () => ({
  searchService: {
    indexRecord: jest.fn(),
    removeRecord: jest.fn(),
    extractTasksFromMeeting: jest.fn(),
  },
  MIN_MEETING_BODY_FOR_EXTRACTION: 50,
}));

import { queryAll, queryOne, execute } from '../db/db';
import { searchService } from '../services/search.service';
import { meetingsRouter } from '../routes/meetings';
import type { AuthRequest } from '../middleware/auth';

function buildApp(userId: number | null) {
  const app = express();
  app.use(express.json());
  app.use((req: AuthRequest, _res, next) => {
    if (userId !== null) req.user = { id: userId, email: 'u@test.com', name: 'U', role: 'user' };
    next();
  });
  app.use('/v1/meetings', meetingsRouter);
  return app;
}

const queryAllMock = queryAll as jest.Mock;
const queryOneMock = queryOne as jest.Mock;
const executeMock = execute as jest.Mock;
const extractMock = searchService.extractTasksFromMeeting as jest.Mock;

describe('POST /v1/meetings — извлечение обязательств', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    executeMock.mockResolvedValue(undefined);
    queryAllMock.mockResolvedValue([]); // project name lookups / people lookups
    // Мок обязан возвращать промис: маршрут навешивает на результат .catch().
    // Без этого вызов бросает синхронно, ответ не отправляется, и тест виснет —
    // ровно так и было поймано, что прямой вызов с .catch() хрупок.
    extractMock.mockResolvedValue(undefined);
  });

  function mockCreatedMeeting(id: number, overrides: Record<string, unknown> = {}) {
    // 1st queryOne: INSERT ... RETURNING id
    // 2nd queryOne (опционально): SELECT name FROM projects
    // last queryOne: SELECT * FROM meetings WHERE id = $1 (финальная выборка для ответа)
    queryOneMock.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO meetings')) return { id };
      if (sql.includes('SELECT name FROM projects')) return { name: 'Проект' };
      if (sql.includes('SELECT * FROM meetings WHERE id')) {
        return { id, title: 'Встреча', date: '2026-09-01', project_id: null, summary_raw: overrides['summary_raw'] ?? '' };
      }
      return null;
    });
  }

  test('substantial summary_raw запускает extractTasksFromMeeting с телом и projectId', async () => {
    mockCreatedMeeting(42, { summary_raw: 'x'.repeat(80) });
    const longBody = 'Обсудили план внедрения нового модуля отчётности и договорились о сроках сдачи первой версии.';
    const res = await request(buildApp(5))
      .post('/v1/meetings')
      .send({ title: 'Встреча по отчётности', date: '2026-09-01', summary_raw: longBody, sync_vault: false });

    expect(res.status).toBe(201);
    expect(extractMock).toHaveBeenCalledTimes(1);
    const [meetingId, title, body, projectId, userId] = extractMock.mock.calls[0]!;
    expect(meetingId).toBe(42);
    expect(title).toBe('Встреча по отчётности');
    expect(body).toBe(longBody);
    expect(projectId).toBeNull();
    expect(userId).toBe(5);
  });

  test('пустой summary_raw не запускает извлечение', async () => {
    mockCreatedMeeting(43, { summary_raw: '' });
    const res = await request(buildApp(5))
      .post('/v1/meetings')
      .send({ title: 'Пустая встреча', date: '2026-09-01', sync_vault: false });

    expect(res.status).toBe(201);
    expect(extractMock).not.toHaveBeenCalled();
  });

  test('короткий (тривиальный) summary_raw не запускает извлечение', async () => {
    mockCreatedMeeting(44, { summary_raw: 'ок, договорились' });
    const res = await request(buildApp(5))
      .post('/v1/meetings')
      .send({ title: 'Короткая встреча', date: '2026-09-01', summary_raw: 'ок, договорились', sync_vault: false });

    expect(res.status).toBe(201);
    expect(extractMock).not.toHaveBeenCalled();
  });

  test('ответ 201 не ждёт извлечения — оно ещё не завершилось к моменту ответа', async () => {
    mockCreatedMeeting(45, {});
    let resolveExtraction!: () => void;
    extractMock.mockReturnValue(new Promise<void>((resolve) => { resolveExtraction = resolve; }));

    const longBody = 'Обсудили план внедрения нового модуля отчётности и договорились о сроках сдачи первой версии.';
    const res = await request(buildApp(5))
      .post('/v1/meetings')
      .send({ title: 'Встреча', date: '2026-09-01', summary_raw: longBody, sync_vault: false });

    // Ответ уже пришёл, а извлечение — всё ещё pending promise, ничем не resolved
    expect(res.status).toBe(201);
    expect(extractMock).toHaveBeenCalledTimes(1);
    // Разрешаем promise ПОСЛЕ проверки ответа — если бы обработчик ждал его, запрос
    // выше не смог бы завершиться раньше этой строки.
    resolveExtraction();
  });

  test('падение внутри extractTasksFromMeeting не превращает создание встречи в ошибку', async () => {
    mockCreatedMeeting(46, {});
    extractMock.mockRejectedValue(new Error('LLM недоступен'));

    const longBody = 'Обсудили план внедрения нового модуля отчётности и договорились о сроках сдачи первой версии.';
    const res = await request(buildApp(5))
      .post('/v1/meetings')
      .send({ title: 'Встреча', date: '2026-09-01', summary_raw: longBody, sync_vault: false });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    // Дать отклонённому промису обработаться .catch()-ем внутри роута, чтобы
    // тест не завершился раньше unhandledRejection (если .catch() пропущен).
    await new Promise((r) => setImmediate(r));
  });
});
