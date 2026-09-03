/**
 * MCP-эндпоинт: протокол JSON-RPC 2.0 (initialize/tools/list/tools/call) и пять
 * инструментов. Слой БД замокан — здесь проверяется маршрутизация JSON-RPC,
 * валидация аргументов и user-scoping вызовов инструментов, а не поведение
 * самих SQL-запросов (это покрыто на уровне routes/tasks.ts и т.д.).
 */
jest.mock('../db/db', () => ({
  query: jest.fn(),
  queryAll: jest.fn(),
  queryOne: jest.fn(),
  execute: jest.fn(),
}));
jest.mock('../services/obsidian.service', () => ({
  ObsidianService: jest.fn().mockImplementation(() => ({
    forUser: jest.fn().mockReturnValue({
      writeTask: jest.fn().mockResolvedValue('Tasks/demo.md'),
      updateTask: jest.fn(),
      deleteFile: jest.fn(),
    }),
  })),
}));
jest.mock('../services/search.service', () => ({
  searchService: { indexRecord: jest.fn(), removeRecord: jest.fn() },
}));

import { queryAll, queryOne } from '../db/db';
import { handleMcp } from '../routes/mcp';

const queryAllMock = queryAll as jest.Mock;
const queryOneMock = queryOne as jest.Mock;

describe('MCP-эндпоинт: протокол', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queryAllMock.mockResolvedValue([]);
    queryOneMock.mockResolvedValue(null);
  });

  test('tools/list возвращает инструменты со схемами', async () => {
    const r = await handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 5);
    expect('result' in r && r.result).toBeDefined();
    const tools = (r as any).result.tools;
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) {
      expect(typeof t.name).toBe('string');
      expect(t.inputSchema).toBeDefined();
      expect(typeof t.description).toBe('string');
    }
    expect(tools.map((t: any) => t.name).sort()).toEqual(
      ['complete_task', 'create_task', 'list_projects', 'list_tasks', 'search_vault'].sort()
    );
  });

  test('неизвестный метод возвращает ошибку JSON-RPC, а не бросает', async () => {
    const r = await handleMcp({ jsonrpc: '2.0', id: 2, method: 'нет-такого' }, 5);
    expect('error' in r).toBe(true);
    expect((r as any).error.code).toBe(-32601);
  });

  test('initialize сообщает протокол и имя сервера', async () => {
    const r = await handleMcp({ jsonrpc: '2.0', id: 3, method: 'initialize' }, 5);
    expect((r as any).result.serverInfo.name).toBe('clarity-space');
    expect((r as any).result.protocolVersion).toBeDefined();
  });

  test('id из запроса эхается обратно в ответе (и в ошибке, и в результате)', async () => {
    const ok = await handleMcp({ jsonrpc: '2.0', id: 'abc-123', method: 'initialize' }, 5);
    expect(ok.id).toBe('abc-123');
    const err = await handleMcp({ jsonrpc: '2.0', id: 'abc-124', method: 'nope' }, 5);
    expect(err.id).toBe('abc-124');
  });
});

describe('MCP-эндпоинт: malformed-input не роняет обработчик', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queryAllMock.mockResolvedValue([]);
    queryOneMock.mockResolvedValue(null);
  });

  test.each([
    ['null', null],
    ['строка вместо объекта', 'garbage'],
    ['число вместо объекта', 42],
    ['массив вместо объекта (batch не поддержан)', [{ jsonrpc: '2.0', method: 'initialize' }]],
    ['объект без method', { jsonrpc: '2.0', id: 1 }],
    ['method не строка', { jsonrpc: '2.0', id: 1, method: 42 }],
    ['undefined', undefined],
  ])('%s → JSON-RPC error, не исключение', async (_label, body) => {
    await expect(handleMcp(body, 5)).resolves.toMatchObject({ error: expect.objectContaining({ code: expect.any(Number) }) });
  });

  test('tools/call без params → -32602', async () => {
    const r = await handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call' }, 5);
    expect((r as any).error.code).toBe(-32602);
  });

  test('tools/call с params не объектом → -32602', async () => {
    const r = await handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: 'oops' }, 5);
    expect((r as any).error.code).toBe(-32602);
  });

  test('tools/call с неизвестным именем инструмента → -32602, БД не трогается', async () => {
    const r = await handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'delete_everything' } }, 5);
    expect((r as any).error.code).toBe(-32602);
    expect(queryOneMock).not.toHaveBeenCalled();
    expect(queryAllMock).not.toHaveBeenCalled();
  });

  test('create_task без обязательного title → -32602, INSERT не выполняется', async () => {
    const r = await handleMcp(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_task', arguments: {} } },
      5
    );
    expect((r as any).error.code).toBe(-32602);
    expect(queryOneMock).not.toHaveBeenCalled();
  });

  test('complete_task с нечисловым task_id → -32602', async () => {
    const r = await handleMcp(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'complete_task', arguments: { task_id: 'abc' } } },
      5
    );
    expect((r as any).error.code).toBe(-32602);
  });

  test('лишние поля в arguments (strict-схема) → -32602', async () => {
    const r = await handleMcp(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_projects', arguments: { hack: true } } },
      5
    );
    expect((r as any).error.code).toBe(-32602);
  });
});

describe('MCP-эндпоинт: tools/call делегирует существующей логике роутов', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queryAllMock.mockResolvedValue([]);
    queryOneMock.mockResolvedValue(null);
  });

  test('list_tasks фильтрует только по вызвавшему пользователю и по умолчанию ограничен 50 (F4)', async () => {
    queryAllMock.mockResolvedValueOnce([{ id: 1, title: 'Демо', user_id: 5 }]); // основной SELECT
    const r = await handleMcp(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_tasks', arguments: {} } },
      5
    );
    const [sql, params] = queryAllMock.mock.calls[0];
    expect(String(sql)).toContain('user_id = $1');
    // Было (до F4): expect(params).toEqual([5]) — без ограничения на размер
    // результата. list_tasks без лимита мог вернуть тысячи задач одним
    // MCP-ответом, раздувая контекст модели. Теперь по умолчанию limit=50 —
    // последний параметр SQL.
    expect(String(sql)).toContain('LIMIT $2');
    expect(params).toEqual([5, 50]);
    const text = (r as any).result.content[0].text;
    expect(JSON.parse(text)[0].title).toBe('Демо');
  });

  test('list_tasks с project_id и status добавляет оба фильтра в SQL и лимит последним параметром', async () => {
    await handleMcp(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_tasks', arguments: { project_id: 9, status: 'todo' } },
      },
      5
    );
    const [sql, params] = queryAllMock.mock.calls[0];
    expect(String(sql)).toContain('project_id = $2');
    expect(String(sql)).toContain('status = $3');
    // Было (до F4): expect(params).toEqual([5, 9, 'todo']).
    expect(String(sql)).toContain('LIMIT $4');
    expect(params).toEqual([5, 9, 'todo', 50]);
  });

  test('list_tasks принимает явный limit и передаёт его в SQL (F4)', async () => {
    await handleMcp(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_tasks', arguments: { limit: 5 } } },
      5
    );
    const [sql, params] = queryAllMock.mock.calls[0];
    expect(String(sql)).toContain('LIMIT $2');
    expect(params).toEqual([5, 5]);
  });

  test('list_tasks отклоняет limit выше разумного максимума как invalid params (F4)', async () => {
    const r = await handleMcp(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_tasks', arguments: { limit: 100000 } } },
      5
    );
    expect((r as any).error?.code).toBe(-32602);
    expect(queryAllMock).not.toHaveBeenCalled();
  });

  test('list_tasks отклоняет limit <= 0 как invalid params (F4)', async () => {
    const r = await handleMcp(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_tasks', arguments: { limit: 0 } } },
      5
    );
    expect((r as any).error?.code).toBe(-32602);
    expect(queryAllMock).not.toHaveBeenCalled();
  });

  test('create_task вставляет с правильным user_id и возвращает созданную задачу', async () => {
    queryOneMock.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO tasks')) return { id: 42 };
      if (sql.includes('FROM people WHERE LOWER(name)')) return null;
      if (sql.includes('SELECT * FROM tasks WHERE id = $1')) {
        return { id: 42, title: 'Подготовить демо', status: 'backlog', priority: 3, urgency: 3, user_id: 5 };
      }
      return null;
    });
    const r = await handleMcp(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'create_task', arguments: { title: 'Подготовить демо' } },
      },
      5
    );
    const insertCall = queryOneMock.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO tasks'));
    expect(insertCall).toBeDefined();
    const [, params] = insertCall!;
    expect(params[params.length - 1]).toBe(5); // user_id последний параметр INSERT
    const text = (r as any).result.content[0].text;
    expect(JSON.parse(text).title).toBe('Подготовить демо');
  });

  test('create_task с чужим project_id отклоняется (owner-check) и не создаёт задачу', async () => {
    queryOneMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM projects WHERE id = $1 AND user_id = $2')) return null; // не мой проект
      return null;
    });
    const r = await handleMcp(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'create_task', arguments: { title: 'Чужой проект', project_id: 999 } },
      },
      5
    );
    expect((r as any).result.isError).toBe(true);
    expect((r as any).result.content[0].text).toMatch(/Project not found/i);
    const insertCall = queryOneMock.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO tasks'));
    expect(insertCall).toBeUndefined();
  });

  test('complete_task на задаче другого пользователя — isError, без утечки данных', async () => {
    // Ownership-запрос ищет id=1 AND user_id=5 (вызывающий пользователь) — для чужой задачи строк нет.
    queryOneMock.mockResolvedValue(null);
    const r = await handleMcp(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'complete_task', arguments: { task_id: 1 } } },
      5
    );
    expect((r as any).result.isError).toBe(true);
    expect((r as any).result.content[0].text).toMatch(/не найдена/i);
    const ownerCall = queryOneMock.mock.calls[0];
    expect(ownerCall[1]).toEqual([1, 5]); // taskId, userId — не чужой userId
  });

  test('complete_task на своей задаче ставит status = done для этого пользователя', async () => {
    queryOneMock.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes('SELECT id FROM tasks WHERE id = $1 AND user_id = $2')) return { id: 1 };
      if (sql.includes('SELECT * FROM tasks WHERE id = $1')) return { id: 1, title: 'X', status: 'done', user_id: 5 };
      return null;
    });
    const r = await handleMcp(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'complete_task', arguments: { task_id: 1 } } },
      5
    );
    const updateCall = (require('../db/db').execute as jest.Mock).mock.calls.find(([sql]: [string]) =>
      sql.includes('UPDATE tasks SET')
    );
    expect(updateCall).toBeDefined();
    expect(String(updateCall[0])).toContain('status = $1');
    expect(updateCall[1]).toEqual(['done', 1, 5]);
    expect((r as any).result.isError).toBeUndefined();
  });

  test('list_projects ограничен вызвавшим пользователем', async () => {
    await handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_projects' } }, 7);
    const [sql, params] = queryAllMock.mock.calls[0];
    expect(String(sql)).toContain('user_id = $1');
    expect(params).toEqual([7]);
  });

  test('search_vault передаёт userId вторым параметром во все запросы поиска', async () => {
    await handleMcp(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_vault', arguments: { query: 'демо' } } },
      11
    );
    expect(queryAllMock.mock.calls.length).toBeGreaterThan(0);
    for (const [sql, params] of queryAllMock.mock.calls) {
      expect(String(sql)).toContain('user_id = $2');
      expect(params).toEqual(['демо', 11]);
    }
  });

  test('два разных userId порождают SQL с разными параметрами — пользователь A не может получить данные B', async () => {
    await handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_tasks', arguments: {} } }, 5);
    const paramsA = queryAllMock.mock.calls[0]![1];
    jest.clearAllMocks();
    queryAllMock.mockResolvedValue([]);
    await handleMcp({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_tasks', arguments: {} } }, 7);
    const paramsB = queryAllMock.mock.calls[0]![1];
    // Было (до F4): expect(paramsA).toEqual([5]) / expect(paramsB).toEqual([7]) —
    // без дефолтного лимита. Теперь последний параметр — limit=50 по умолчанию.
    expect(paramsA).toEqual([5, 50]);
    expect(paramsB).toEqual([7, 50]);
  });
});
