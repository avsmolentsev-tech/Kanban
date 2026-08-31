/**
 * Мягкая деградация: без ключа модели AI-эндпоинты не должны падать (и уж тем более
 * ронять процесс) — они должны отвечать 501 с понятным русским сообщением, до того
 * как код долетит до обращения к провайдеру или к БД.
 *
 * Два независимых гварда:
 *  - aiRouter (routes/ai.ts)       — isAiClientConfigured()      (ключ ClaudeService.client)
 *  - advisorsRouter (routes/advisors.ts) — isAdvisorClientConfigured() (ключ ClaudeService.advisorClient)
 */
import express from 'express';
import request from 'supertest';

describe('деградация роутов без ключа модели (гварды замоканы напрямую)', () => {
  // jest.resetModules() очищает реестр require — фабрика jest.mock переисполняется
  // заново на каждый свежий require, поэтому предикат-гвард нужно брать из ТОГО ЖЕ
  // свежего require, что и роутер, а не из статического импорта наверху файла.
  function mockClaudeService(): void {
    jest.mock('../services/claude.service', () => ({
      ClaudeService: jest.fn().mockImplementation(() => ({
        chat: jest.fn(),
        dailyBrief: jest.fn(),
        searchKnowledge: jest.fn(),
        advisorAnalyze: jest.fn(),
        advisorReply: jest.fn(),
        advisorSynthesize: jest.fn(),
        advisorCouncilReply: jest.fn(),
      })),
      isAiClientConfigured: jest.fn(),
      isAdvisorClientConfigured: jest.fn(),
    }));
  }

  function buildAiApp(configured: boolean) {
    jest.resetModules();
    mockClaudeService();
    const claudeServiceModule = require('../services/claude.service');
    (claudeServiceModule.isAiClientConfigured as jest.Mock).mockReturnValue(configured);
    jest.mock('../services/obsidian.service', () => ({ ObsidianService: jest.fn().mockImplementation(() => ({})) }));
    // Изолируем от 429: цель этих тестов — только гвард 501, а не лимит сообщений.
    jest.mock('../middleware/plan', () => ({ checkAiLimit: jest.fn().mockResolvedValue({ allowed: true, used: 0, limit: null }) }));
    const { aiRouter } = require('../routes/ai');
    const app = express();
    app.use(express.json());
    app.use('/v1/ai', aiRouter);
    return app;
  }

  function buildAdvisorsApp(configured: boolean) {
    jest.resetModules();
    mockClaudeService();
    const claudeServiceModule = require('../services/claude.service');
    (claudeServiceModule.isAdvisorClientConfigured as jest.Mock).mockReturnValue(configured);
    jest.mock('../middleware/plan', () => ({ checkAiLimit: jest.fn().mockResolvedValue({ allowed: true, used: 0, limit: null }) }));
    // GET /v1/advisors/ (список советников) идёт в БД через loadAdvisors — не
    // поднимаем реальное соединение в юнит-тесте гварда.
    jest.mock('../db/db', () => ({
      queryAll: jest.fn().mockResolvedValue([]),
      queryOne: jest.fn().mockResolvedValue(null),
      execute: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue({ rows: [] }),
    }));
    const { advisorsRouter } = require('../routes/advisors');
    const app = express();
    app.use(express.json());
    app.use('/v1/advisors', advisorsRouter);
    return app;
  }

  test('aiRouter: ключа нет → POST /chat отвечает 501 с русским сообщением, а не падает', async () => {
    const app = buildAiApp(false);
    const res = await request(app).post('/v1/ai/chat').send({ messages: [{ role: 'user', content: 'привет' }] });
    expect(res.status).toBe(501);
    expect(res.body).toEqual({ success: false, error: expect.stringContaining('не настроен') });
  });

  test('aiRouter: ключа нет → GET /search тоже отвечает 501, а не 500/падением процесса', async () => {
    const app = buildAiApp(false);
    const res = await request(app).get('/v1/ai/search').query({ q: 'тест' });
    expect(res.status).toBe(501);
  });

  // Ранее этот тест проверял только res.status !== 501 — регрессия до 400/429/500
  // прошла бы незамеченной. checkAiLimit замокан выше в allowed:true специально для
  // того, чтобы этот тест проверял именно гвард, а не лимит сообщений (без мока сюда
  // прилетал бы 429, потому что в тестовом запросе нет авторизованного пользователя).
  test('aiRouter: ключ есть → 501-гвард не срабатывает, запрос доходит до обработчика и завершается 2xx', async () => {
    const app = buildAiApp(true);
    const res = await request(app).post('/v1/ai/chat').send({ messages: [{ role: 'user', content: 'привет' }] });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
  });

  test('advisorsRouter: ключа нет → POST /analyze отвечает 501 с русским сообщением, а не падает', async () => {
    const app = buildAdvisorsApp(false);
    const res = await request(app).post('/v1/advisors/analyze').send({ advisor_ids: [1], context: 'ситуация' });
    expect(res.status).toBe(501);
    expect(res.body).toEqual({ success: false, error: expect.stringContaining('не настроен') });
  });

  test('advisorsRouter: ключа нет → GET / (список советников) тоже отвечает 501, а не падает на БД', async () => {
    const app = buildAdvisorsApp(false);
    const res = await request(app).get('/v1/advisors/');
    expect(res.status).toBe(501);
  });

  test('advisorsRouter: ключ есть → 501-гвард не срабатывает (запрос идёт дальше в обработчик)', async () => {
    const app = buildAdvisorsApp(true);
    const res = await request(app).get('/v1/advisors/');
    expect(res.status).not.toBe(501);
  });
});

/**
 * Реалистичные комбинации ключей — через НАСТОЯЩИЙ предикат (isAiClientConfigured /
 * isAdvisorClientConfigured не мокаются), мокается только сетевой клиент
 * ClaudeService. Это ловит то, что не поймать моком предиката напрямую: конфликт
 * между тем, какой ключ реально читает config, и тем, какой ключ ожидает каждый
 * роутер.
 */
describe('деградация роутов при реалистичных комбинациях переменных окружения (гварды настоящие)', () => {
  jest.mock('dotenv', () => ({ config: jest.fn() }));

  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    delete process.env['ADVISOR_OPENAI_API_KEY'];
  });

  afterAll(() => { process.env = OLD_ENV; });

  function mockClaudeNetworkClient(): void {
    jest.mock('../services/claude.service', () => {
      const actual = jest.requireActual('../services/claude.service');
      return {
        ...actual,
        ClaudeService: jest.fn().mockImplementation(() => ({
          chat: jest.fn(),
          dailyBrief: jest.fn(),
          searchKnowledge: jest.fn(),
          advisorAnalyze: jest.fn(),
          advisorReply: jest.fn(),
          advisorSynthesize: jest.fn(),
          advisorCouncilReply: jest.fn(),
        })),
      };
    });
    jest.mock('../services/obsidian.service', () => ({ ObsidianService: jest.fn().mockImplementation(() => ({})) }));
    jest.mock('../middleware/plan', () => ({ checkAiLimit: jest.fn().mockResolvedValue({ allowed: true, used: 0, limit: null }) }));
    // GET /v1/advisors/ идёт в БД через loadAdvisors — не поднимаем реальное
    // соединение в юнит-тесте гварда.
    jest.mock('../db/db', () => ({
      queryAll: jest.fn().mockResolvedValue([]),
      queryOne: jest.fn().mockResolvedValue(null),
      execute: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue({ rows: [] }),
    }));
  }

  function buildAiApp() {
    mockClaudeNetworkClient();
    const { aiRouter } = require('../routes/ai');
    const app = express();
    app.use(express.json());
    app.use('/v1/ai', aiRouter);
    return app;
  }

  function buildAdvisorsApp() {
    mockClaudeNetworkClient();
    const { advisorsRouter } = require('../routes/advisors');
    const app = express();
    app.use(express.json());
    app.use('/v1/advisors', advisorsRouter);
    return app;
  }

  describe('только ANTHROPIC_API_KEY задан (мёртвый ключ)', () => {
    beforeEach(() => { process.env['ANTHROPIC_API_KEY'] = 'ant-key'; });

    test('aiRouter → 501 (ClaudeService.client не питается этим ключом)', async () => {
      const app = buildAiApp();
      const res = await request(app).post('/v1/ai/chat').send({ messages: [{ role: 'user', content: 'привет' }] });
      expect(res.status).toBe(501);
    });

    test('advisorsRouter → 501 (advisorClient тоже не питается этим ключом)', async () => {
      const app = buildAdvisorsApp();
      const res = await request(app).get('/v1/advisors/');
      expect(res.status).toBe(501);
    });
  });

  describe('только ADVISOR_OPENAI_API_KEY задан', () => {
    beforeEach(() => { process.env['ADVISOR_OPENAI_API_KEY'] = 'adv-key'; });

    test('aiRouter → 501 (this.client в ClaudeService остаётся без ключа)', async () => {
      const app = buildAiApp();
      const res = await request(app).post('/v1/ai/chat').send({ messages: [{ role: 'user', content: 'привет' }] });
      expect(res.status).toBe(501);
    });

    test('advisorsRouter → пропускает гвард (это и есть ключ advisor-клиента)', async () => {
      const app = buildAdvisorsApp();
      const res = await request(app).get('/v1/advisors/');
      expect(res.status).not.toBe(501);
    });
  });

  describe('только OPENAI_API_KEY задан', () => {
    beforeEach(() => { process.env['OPENAI_API_KEY'] = 'oai-key'; });

    test('aiRouter → пропускает гвард и отвечает 2xx', async () => {
      const app = buildAiApp();
      const res = await request(app).post('/v1/ai/chat').send({ messages: [{ role: 'user', content: 'привет' }] });
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(300);
    });

    test('advisorsRouter → тоже пропускает гвард (advisor-клиент падает обратно на общий ключ)', async () => {
      const app = buildAdvisorsApp();
      const res = await request(app).get('/v1/advisors/');
      expect(res.status).not.toBe(501);
    });
  });

  describe('ни один ключ не задан', () => {
    test('aiRouter → 501', async () => {
      const app = buildAiApp();
      const res = await request(app).post('/v1/ai/chat').send({ messages: [{ role: 'user', content: 'привет' }] });
      expect(res.status).toBe(501);
    });

    test('advisorsRouter → 501', async () => {
      const app = buildAdvisorsApp();
      const res = await request(app).get('/v1/advisors/');
      expect(res.status).toBe(501);
    });
  });
});
