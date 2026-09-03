/**
 * Fix 2 (task-7 демо-готовности): Swagger UI на /v1/docs подключается с CDN
 * (unpkg.com). Для интегратора за ограниченной сетью это единственная точка
 * отказа — страница рендерится пустой без объяснения. Проверяем, что HTML
 * содержит понятный русский фолбэк на случай недоступности бандла и на
 * случай отключённого JavaScript, а не просто падает в тишину.
 */
import express from 'express';
import request from 'supertest';
import { docsRouter } from '../routes/docs';

function buildApp() {
  const app = express();
  app.use(docsRouter);
  return app;
}

describe('GET /docs — фолбэк при недоступности CDN', () => {
  test('страница отдаётся с кодом 200 и типом text/html', async () => {
    const res = await request(buildApp()).get('/docs');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  test('есть блок-фолбэк на русском с адресом /v1/openapi.yaml на случай недоступности бандла', async () => {
    const res = await request(buildApp()).get('/docs');
    expect(res.text).toContain('id="docs-fallback"');
    expect(res.text).toContain('/v1/openapi.yaml');
    expect(res.text).toMatch(/не загрузил|недоступ/i);
  });

  test('скрипт бандла подключает showDocsFallback через onerror (реальная реакция на отказ CDN)', () => {
    // Регресс: раньше страница просто вызывала SwaggerUIBundle(...) без
    // проверки, что скрипт вообще загрузился — при заблокированном CDN
    // это падало тихим JS-исключением, а не понятным сообщением.
    return request(buildApp())
      .get('/docs')
      .then((res) => {
        expect(res.text).toMatch(/onerror="showDocsFallback\(\)"/);
        expect(res.text).toMatch(/if \(window\.SwaggerUIBundle\)/);
      });
  });

  test('есть <noscript>-блок на случай отключённого JavaScript', async () => {
    const res = await request(buildApp()).get('/docs');
    expect(res.text).toContain('<noscript>');
    expect(res.text).toMatch(/Нужен JavaScript/);
  });

  test('страница ссылается на unpkg.com — фиксирует CDN-зависимость явным образом', async () => {
    const res = await request(buildApp()).get('/docs');
    expect(res.text).toContain('unpkg.com/swagger-ui-dist');
  });
});

describe('GET /openapi.yaml', () => {
  test('отдаёт текст спецификации с типом text/yaml', async () => {
    const res = await request(buildApp()).get('/openapi.yaml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/yaml/);
    expect(res.text).toMatch(/^openapi:\s*3\.1/m);
  });
});
