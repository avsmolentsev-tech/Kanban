// В локальном .env разработчика (не в репозитории) может лежать реальный ключ —
// dotenv.config() подхватил бы его при переимпорте config и свёл на нет удаление
// переменной из process.env в тесте. Мокаем dotenv, чтобы тест был детерминирован
// независимо от содержимого .env на машине, где он запускается.
jest.mock('dotenv', () => ({ config: jest.fn() }));

describe('предикаты готовности LLM-клиентов', () => {
  const OLD = process.env;
  beforeEach(() => { jest.resetModules(); process.env = { ...OLD }; });
  afterAll(() => { process.env = OLD; });

  function clearAllKeys(): void {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    delete process.env['ADVISOR_OPENAI_API_KEY'];
  }

  describe('isAiClientConfigured (гвард aiRouter — routes/ai.ts, ClaudeService.client)', () => {
    test('ни один ключ не задан → не настроен', () => {
      clearAllKeys();
      const { isAiClientConfigured } = require('../services/claude.service');
      expect(isAiClientConfigured()).toBe(false);
    });

    // Раньше (до фикса) ANTHROPIC_API_KEY засчитывался в общий isLlmConfigured() —
    // хотя ClaudeService.client собирается только из config.openaiApiKey (см.
    // конструктор), Anthropic SDK клиента в сервисе нет вообще. Оператор, задавший
    // только ANTHROPIC_API_KEY, видел бы "AI настроен", а на первом же запросе к
    // /chat получал бы 500 с сырым текстом ошибки OpenAI SDK.
    test('только ANTHROPIC_API_KEY → НЕ настроен (мёртвый ключ, клиента для него нет)', () => {
      clearAllKeys();
      process.env['ANTHROPIC_API_KEY'] = 'ant-key';
      const { isAiClientConfigured } = require('../services/claude.service');
      expect(isAiClientConfigured()).toBe(false);
    });

    // Раньше ADVISOR_OPENAI_API_KEY тоже засчитывался в общий isLlmConfigured() —
    // хотя он идёт только в advisorClient, а aiRouter использует this.client с
    // пустым OPENAI_API_KEY.
    test('только ADVISOR_OPENAI_API_KEY → НЕ настроен (питает только advisor-клиент)', () => {
      clearAllKeys();
      process.env['ADVISOR_OPENAI_API_KEY'] = 'adv-key';
      const { isAiClientConfigured } = require('../services/claude.service');
      expect(isAiClientConfigured()).toBe(false);
    });

    test('только OPENAI_API_KEY → настроен (это и есть ключ this.client)', () => {
      clearAllKeys();
      process.env['OPENAI_API_KEY'] = 'oai-key';
      const { isAiClientConfigured } = require('../services/claude.service');
      expect(isAiClientConfigured()).toBe(true);
    });
  });

  describe('isAdvisorClientConfigured (гвард advisorsRouter — routes/advisors.ts, ClaudeService.advisorClient)', () => {
    test('ни один ключ не задан → не настроен', () => {
      clearAllKeys();
      const { isAdvisorClientConfigured } = require('../services/claude.service');
      expect(isAdvisorClientConfigured()).toBe(false);
    });

    test('только ANTHROPIC_API_KEY → НЕ настроен (мёртвый ключ, клиента для него нет)', () => {
      clearAllKeys();
      process.env['ANTHROPIC_API_KEY'] = 'ant-key';
      const { isAdvisorClientConfigured } = require('../services/claude.service');
      expect(isAdvisorClientConfigured()).toBe(false);
    });

    test('только ADVISOR_OPENAI_API_KEY → настроен (это и есть основной ключ advisor-клиента)', () => {
      clearAllKeys();
      process.env['ADVISOR_OPENAI_API_KEY'] = 'adv-key';
      const { isAdvisorClientConfigured } = require('../services/claude.service');
      expect(isAdvisorClientConfigured()).toBe(true);
    });

    // advisorClient = new OpenAI({ apiKey: advisorApiKey || openaiApiKey, ... }) —
    // фолбэк на основной ключ реален, если отдельный advisor-ключ не задан.
    test('только OPENAI_API_KEY → настроен (advisor-клиент падает обратно на общий ключ)', () => {
      clearAllKeys();
      process.env['OPENAI_API_KEY'] = 'oai-key';
      const { isAdvisorClientConfigured } = require('../services/claude.service');
      expect(isAdvisorClientConfigured()).toBe(true);
    });
  });

  describe('llmProviderName', () => {
    test('с базовым URL Яндекса имя провайдера отражает это', () => {
      process.env['OPENAI_API_KEY'] = 'k';
      process.env['OPENAI_BASE_URL'] = 'https://llm.api.cloud.yandex.net/v1';
      const { llmProviderName } = require('../services/claude.service');
      expect(llmProviderName()).toContain('yandex');
    });

    test('без базового URL провайдер по умолчанию', () => {
      process.env['OPENAI_API_KEY'] = 'k';
      delete process.env['OPENAI_BASE_URL'];
      const { llmProviderName } = require('../services/claude.service');
      expect(llmProviderName()).toBe('default');
    });
  });
});
