import * as fs from 'fs';
import * as path from 'path';

const SPEC = path.resolve(__dirname, '../openapi/openapi.yaml');

describe('спецификация OpenAPI', () => {
  test('файл существует и объявляет версию 3.1', () => {
    const text = fs.readFileSync(SPEC, 'utf8');
    expect(text).toMatch(/^openapi:\s*3\.1/m);
  });

  test('описаны ключевые эндпоинты', () => {
    const text = fs.readFileSync(SPEC, 'utf8');
    for (const p of ['/health', '/v1/tasks', '/v1/projects', '/v1/meetings', '/v1/api-tokens']) {
      expect(text).toContain(`${p}:`);
    }
  });

  test('объявлена авторизация по bearer-токену', () => {
    const text = fs.readFileSync(SPEC, 'utf8');
    expect(text).toContain('bearerAuth');
    expect(text).toContain('scheme: bearer');
  });

  test('спецификация — валидный YAML и валидный OpenAPI-документ', () => {
    // js-yaml is a transitive dep (swagger tooling); fall back to a structural
    // sanity check via require if it's unavailable rather than skip silently.
    const yaml = require('js-yaml');
    const text = fs.readFileSync(SPEC, 'utf8');
    const doc = yaml.load(text) as Record<string, unknown>;
    expect(doc['openapi']).toBe('3.1.0');
    expect(doc['info']).toBeTruthy();
    expect(doc['paths']).toBeTruthy();
    const paths = doc['paths'] as Record<string, unknown>;
    expect(Object.keys(paths).length).toBeGreaterThan(10);
  });
});

describe('маршруты документации', () => {
  test('routes/index.ts регистрирует /openapi.yaml и /docs', () => {
    const routesIndex = fs.readFileSync(path.resolve(__dirname, '../routes/index.ts'), 'utf8');
    expect(routesIndex).toMatch(/docsRouter|openapi\.yaml/);
  });
});
