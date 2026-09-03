/**
 * /health и /mcp объявлены вне app.use('/v1/', ...) в index.ts, поэтому общий
 * REST-лимитер (path-scoped на /v1/) их не покрывает — F1. index.ts нельзя
 * безопасно импортировать в jest (на верхнем уровне модуля вызывает start(),
 * которая реально подключается к Postgres), поэтому:
 *  - поведение лимитеров проверяется через middleware/rate-limit.ts напрямую
 *    (та же логика/объекты, что монтирует index.ts);
 *  - сам факт, что index.ts подключает healthRateLimit/mcpRateLimit именно к
 *    /health и /mcp, проверяется чтением исходника (см. второй describe).
 */
import * as fs from 'fs';
import * as path from 'path';
import express from 'express';
import request from 'supertest';
import {
  healthRateLimit,
  mcpRateLimit,
  HEALTH_RATE_LIMIT_MAX,
  MCP_RATE_LIMIT_MAX,
  API_RATE_LIMIT_MAX,
  AUTH_RATE_LIMIT_MAX,
} from '../middleware/rate-limit';

describe('healthRateLimit — REST-конверт { success: false }', () => {
  test(`пропускает до ${HEALTH_RATE_LIMIT_MAX} запросов/мин, дальше — 429 c REST-телом`, async () => {
    const app = express();
    app.get('/health', healthRateLimit, (_req, res) => res.json({ status: 'ok' }));

    for (let i = 0; i < HEALTH_RATE_LIMIT_MAX; i++) {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
    }
    const blocked = await request(app).get('/health');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ success: false, error: 'Too many requests. Please try again later.' });
  }, 20000);
});

describe('mcpRateLimit — форма JSON-RPC 2.0, не REST-конверт', () => {
  test(`пропускает до ${MCP_RATE_LIMIT_MAX} запросов/мин, дальше — 429 c JSON-RPC телом`, async () => {
    const app = express();
    app.use(express.json());
    app.post('/mcp', mcpRateLimit, (_req, res) => res.json({ jsonrpc: '2.0', id: 1, result: {} }));

    for (let i = 0; i < MCP_RATE_LIMIT_MAX; i++) {
      const res = await request(app).post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
      expect(res.status).toBe(200);
    }
    const blocked = await request(app).post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32000, message: 'Too many requests. Please try again later.' },
    });
  }, 20000);
});

describe('лимиты — сознательный выбор значений', () => {
  test('health лимит ниже общего REST-лимита, но выше типичного интервала опроса мониторингом', () => {
    expect(HEALTH_RATE_LIMIT_MAX).toBeLessThan(API_RATE_LIMIT_MAX);
    expect(HEALTH_RATE_LIMIT_MAX).toBeGreaterThan(AUTH_RATE_LIMIT_MAX);
  });

  test('mcp лимит ниже общего REST-лимита (человек, не браузерная толпа), но выше health', () => {
    expect(MCP_RATE_LIMIT_MAX).toBeLessThan(API_RATE_LIMIT_MAX);
  });
});

describe('index.ts подключает лимитеры к /health и /mcp (source check, F1)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../index.ts'), 'utf8');

  test('healthRateLimit и mcpRateLimit импортированы из middleware/rate-limit', () => {
    expect(src).toMatch(/from '\.\/middleware\/rate-limit'/);
    expect(src).toContain('healthRateLimit');
    expect(src).toContain('mcpRateLimit');
  });

  test("app.get('/health', ...) подключает healthRateLimit", () => {
    expect(src).toMatch(/app\.get\('\/health',\s*healthRateLimit/);
  });

  test("app.post('/mcp', ...) подключает mcpRateLimit до requireAuth", () => {
    expect(src).toMatch(/app\.post\('\/mcp',\s*mcpRateLimit,\s*requireAuth/);
  });
});
