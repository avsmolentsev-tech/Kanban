import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  const OLD = process.env;
  afterEach(() => { process.env = OLD; });

  test('parses happy path', () => {
    process.env = { ...OLD, TELEGRAM_OPS_BOT_TOKEN: 't', ALLOWED_TG_ID: '42' };
    const c = loadConfig();
    expect(c.telegramToken).toBe('t');
    expect(c.allowedTgId).toBe(42);
    expect(c.sessionTimeoutMs).toBe(30 * 60_000);
    expect(c.defaultModel).toBe('sonnet');
  });

  test('throws when token missing', () => {
    process.env = { ...OLD, ALLOWED_TG_ID: '42' };
    delete process.env.TELEGRAM_OPS_BOT_TOKEN;
    expect(() => loadConfig()).toThrow(/TELEGRAM_OPS_BOT_TOKEN/);
  });

  test('throws when allowed tg id missing or non-numeric', () => {
    process.env = { ...OLD, TELEGRAM_OPS_BOT_TOKEN: 't', ALLOWED_TG_ID: 'abc' };
    expect(() => loadConfig()).toThrow(/ALLOWED_TG_ID/);
  });
});
