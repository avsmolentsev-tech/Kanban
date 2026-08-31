// В локальном .env разработчика (не в репозитории) может лежать реальный ключ —
// dotenv.config() подхватил бы его при переимпорте config и свёл на нет удаление
// переменной из process.env в тесте. Мокаем dotenv, чтобы тест был детерминирован
// независимо от содержимого .env на машине, где он запускается.
jest.mock('dotenv', () => ({ config: jest.fn() }));

describe('провайдер LLM', () => {
  const OLD = process.env;
  beforeEach(() => { jest.resetModules(); process.env = { ...OLD }; });
  afterAll(() => { process.env = OLD; });

  test('без ключей провайдер считается ненастроенным', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    delete process.env['ADVISOR_OPENAI_API_KEY'];
    const { isLlmConfigured } = require('../services/claude.service');
    expect(isLlmConfigured()).toBe(false);
  });

  test('только ключ advisor-клиента тоже считается настроенным провайдером', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    process.env['ADVISOR_OPENAI_API_KEY'] = 'k';
    const { isLlmConfigured } = require('../services/claude.service');
    expect(isLlmConfigured()).toBe(true);
  });

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
