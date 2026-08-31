/**
 * Мягкая деградация: без ключа модели AI-эндпоинты не должны падать (и уж тем более
 * ронять процесс) — они должны отвечать 501 с понятным русским сообщением, до того
 * как код долетит до обращения к провайдеру или к БД.
 */
import express from 'express';
import request from 'supertest';

jest.mock('../services/claude.service', () => ({
  ClaudeService: jest.fn().mockImplementation(() => ({
    chat: jest.fn(),
    dailyBrief: jest.fn(),
    searchKnowledge: jest.fn(),
  })),
  isLlmConfigured: jest.fn(),
}));

jest.mock('../services/obsidian.service', () => ({
  ObsidianService: jest.fn().mockImplementation(() => ({})),
}));

describe('деградация AI-роутов без ключа модели', () => {
  // jest.resetModules() очищает реестр require — фабрика jest.mock переисполняется
  // заново на каждый свежий require, поэтому isLlmConfigured нужно брать из ТОГО ЖЕ
  // свежего require, что и aiRouter, а не из статического импорта наверху файла.
  function buildApp(configured: boolean) {
    jest.resetModules();
    const claudeServiceModule = require('../services/claude.service');
    (claudeServiceModule.isLlmConfigured as jest.Mock).mockReturnValue(configured);
    const { aiRouter } = require('../routes/ai');
    const app = express();
    app.use(express.json());
    app.use('/v1/ai', aiRouter);
    return app;
  }

  test('ключа нет → POST /chat отвечает 501 с русским сообщением, а не падает', async () => {
    const app = buildApp(false);
    const res = await request(app).post('/v1/ai/chat').send({ messages: [{ role: 'user', content: 'привет' }] });
    expect(res.status).toBe(501);
    expect(res.body).toEqual({ success: false, error: expect.stringContaining('не настроен') });
  });

  test('ключа нет → GET /search тоже отвечает 501, а не 500/падением процесса', async () => {
    const app = buildApp(false);
    const res = await request(app).get('/v1/ai/search').query({ q: 'тест' });
    expect(res.status).toBe(501);
  });

  test('ключ есть → 501-гвард не срабатывает (запрос идёт дальше в обработчик)', async () => {
    const app = buildApp(true);
    const res = await request(app).post('/v1/ai/chat').send({ messages: [{ role: 'user', content: 'привет' }] });
    expect(res.status).not.toBe(501);
  });
});
