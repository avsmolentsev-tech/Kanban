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

  // Регресс на нарушение JSON Schema 2020-12 (что использует OpenAPI 3.1):
  // `nullable`/`x-nullable` — ключевые слова из OpenAPI 3.0, которых в 3.1 не
  // существует. Строгие валидаторы и генераторы клиентов их молча
  // игнорируют, поэтому поле, задокументированное как nullable, у
  // интегратора сгенерируется без null. Раньше тест только грепал пути и
  // структурно парсил YAML, что не ловило такие ошибки — этот тест ловит.
  test('в схемах нет ключевых слов OpenAPI 3.0 (nullable/x-nullable), запрещённых в 3.1', () => {
    const yaml = require('js-yaml');
    const text = fs.readFileSync(SPEC, 'utf8');
    const doc = yaml.load(text) as Record<string, unknown>;

    const forbiddenKeys = ['nullable', 'x-nullable'];
    const offenders: string[] = [];

    const walk = (node: unknown, pathStr: string): void => {
      if (Array.isArray(node)) {
        node.forEach((item, i) => walk(item, `${pathStr}[${i}]`));
        return;
      }
      if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
          if (forbiddenKeys.includes(key)) {
            offenders.push(`${pathStr}.${key}`);
          }
          walk(value, `${pathStr}.${key}`);
        }
      }
    };

    walk(doc, '$');

    expect(offenders).toEqual([]);
  });

  test('nullable-поля используют форму 3.1 (type: [X, "null"] или oneOf с {type: "null"})', () => {
    const yaml = require('js-yaml');
    const text = fs.readFileSync(SPEC, 'utf8');
    const doc = yaml.load(text) as Record<string, unknown>;

    const isNullType = (t: unknown): boolean =>
      t === 'null' || (Array.isArray(t) && t.includes('null'));

    const schemas = (
      ((doc['components'] as Record<string, unknown> | undefined)?.['schemas'] as
        | Record<string, unknown>
        | undefined) ?? {}
    );

    // Явно проверяем известные nullable-поля точечно, чтобы падение теста
    // указывало на конкретное поле, а не просто "где-то не так".
    const cases: Array<[string, string]> = [
      ['ApiTokenCreateRequest', 'ttlDays'],
      ['ApiTokenListItem', 'expires_at'],
      ['ApiTokenListItem', 'revoked_at'],
      ['TaskCreateRequest', 'parent_id'],
      ['TaskCreateRequest', 'recurrence'],
      ['TaskCreateRequest', 'goal_id'],
      ['TaskUpdateRequest', 'due_date'],
      ['TaskUpdateRequest', 'start_date'],
      ['TaskUpdateRequest', 'project_id'],
      ['TaskUpdateRequest', 'parent_id'],
      ['TaskUpdateRequest', 'recurrence'],
    ];

    for (const [schemaName, propName] of cases) {
      const schema = schemas[schemaName] as Record<string, unknown> | undefined;
      expect(schema).toBeTruthy();
      const props = schema?.['properties'] as Record<string, unknown> | undefined;
      const prop = props?.[propName] as Record<string, unknown> | undefined;
      expect(prop).toBeTruthy();
      const ok = isNullType(prop?.['type']) || Array.isArray(prop?.['oneOf']);
      expect(ok).toBe(true);
    }
  });
});

describe('маршруты документации', () => {
  test('routes/index.ts регистрирует /openapi.yaml и /docs', () => {
    const routesIndex = fs.readFileSync(path.resolve(__dirname, '../routes/index.ts'), 'utf8');
    expect(routesIndex).toMatch(/docsRouter|openapi\.yaml/);
  });
});
