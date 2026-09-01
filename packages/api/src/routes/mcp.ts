/**
 * MCP-эндпоинт (Model Context Protocol) поверх JSON-RPC 2.0.
 *
 * Пять инструментов — тонкие обёртки над логикой, которая уже живёт в
 * соответствующих HTTP-роутах (см. `listTasksForUser`/`createTaskForUser`/
 * `updateTaskForUser` в routes/tasks.ts, `listProjectsForUser` в
 * routes/projects.ts, `searchAllForUser` в routes/search.ts) — SQL и побочные
 * эффекты (sync в vault, self-assign) не дублируются, а переиспользуются.
 *
 * `handleMcp` — чистая функция без побочного знания об Express: принимает уже
 * распарсенное тело запроса и userId аутентифицированного пользователя (его
 * достаёт HTTP-обвязка в index.ts через requireAuth + getUserId). Никогда не
 * бросает исключение наружу — любая ошибка превращается в JSON-RPC error
 * object либо в результат вызова инструмента с `isError: true`.
 */
import { z, ZodTypeAny } from 'zod';
import { listTasksForUser, createTaskForUser, completeTaskForUser } from './tasks';
import { listProjectsForUser } from './projects';
import { searchAllForUser } from './search';

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: string | number | null;
  result: unknown;
}

export interface JsonRpcError {
  jsonrpc: '2.0';
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

const SERVER_INFO = { name: 'clarity-space', version: '1.0.0' };
// Дата-версия протокола MCP, которую мы поддерживаем (базовый набор initialize/tools/*).
const PROTOCOL_VERSION = '2024-11-05';

const JSON_RPC_ERRORS = {
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

function success(id: string | number | null, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result };
}

function error(id: string | number | null, code: number, message: string): JsonRpcError {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/** Достаёт id из тела запроса даже если остальное тело некорректно — JSON-RPC требует эхо id, где возможно. */
function extractId(body: unknown): string | number | null {
  if (body && typeof body === 'object' && !Array.isArray(body) && 'id' in (body as Record<string, unknown>)) {
    const id = (body as Record<string, unknown>)['id'];
    if (typeof id === 'string' || typeof id === 'number') return id;
  }
  return null;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  argsSchema: ZodTypeAny;
  run: (userId: number, args: any) => Promise<unknown>;
}

const TOOLS: ToolDef[] = [
  {
    name: 'list_tasks',
    description: 'Список задач текущего пользователя с опциональной фильтрацией по проекту и статусу',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: ['integer', 'null'], description: 'ID проекта для фильтрации' },
        status: {
          type: 'string',
          enum: ['backlog', 'todo', 'in_progress', 'done', 'someday'],
          description: 'Статус задачи для фильтрации',
        },
      },
      additionalProperties: false,
    },
    argsSchema: z
      .object({
        project_id: z.number().int().nullable().optional(),
        status: z.enum(['backlog', 'todo', 'in_progress', 'done', 'someday']).optional(),
      })
      .strict(),
    run: (userId, args) =>
      listTasksForUser(userId, { project_id: args.project_id ?? undefined, status: args.status ?? undefined }),
  },
  {
    name: 'create_task',
    description: 'Создать новую задачу в Clarity Space',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, description: 'Заголовок задачи' },
        description: { type: 'string', description: 'Описание задачи' },
        project_id: { type: ['integer', 'null'], description: 'ID проекта, к которому относится задача' },
        priority: { type: 'integer', minimum: 1, maximum: 5, description: 'Приоритет от 1 (низкий) до 5 (высокий)' },
        due_date: { type: ['string', 'null'], description: 'Срок выполнения в формате YYYY-MM-DD' },
      },
      required: ['title'],
      additionalProperties: false,
    },
    argsSchema: z
      .object({
        title: z.string().min(1),
        description: z.string().optional(),
        project_id: z.number().int().nullable().optional(),
        priority: z.number().int().min(1).max(5).optional(),
        due_date: z.string().nullable().optional(),
      })
      .strict(),
    run: (userId, args) => createTaskForUser(userId, args),
  },
  {
    name: 'complete_task',
    description: 'Отметить задачу выполненной по её id',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'integer', description: 'ID задачи' },
      },
      required: ['task_id'],
      additionalProperties: false,
    },
    argsSchema: z.object({ task_id: z.number().int() }).strict(),
    run: async (userId, args) => {
      const task = await completeTaskForUser(userId, args.task_id);
      if (!task) throw new Error('Задача не найдена или принадлежит другому пользователю');
      return task;
    },
  },
  {
    name: 'list_projects',
    description: 'Список проектов текущего пользователя',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    argsSchema: z.object({}).strict(),
    run: (userId) => listProjectsForUser(userId),
  },
  {
    name: 'search_vault',
    description: 'Полнотекстовый поиск по задачам, встречам, людям, идеям и документам пользователя',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, description: 'Поисковый запрос' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    argsSchema: z.object({ query: z.string().min(1) }).strict(),
    run: (userId, args) => searchAllForUser(userId, args.query),
  },
];

async function handleToolsCall(id: string | number | null, userId: number, params: unknown): Promise<JsonRpcResponse> {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return error(id, JSON_RPC_ERRORS.INVALID_PARAMS, 'params должен быть объектом с полями name и arguments');
  }
  const { name, arguments: rawArgs } = params as { name?: unknown; arguments?: unknown };
  if (typeof name !== 'string' || name.length === 0) {
    return error(id, JSON_RPC_ERRORS.INVALID_PARAMS, 'params.name должен быть непустой строкой');
  }
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) {
    return error(id, JSON_RPC_ERRORS.INVALID_PARAMS, `Неизвестный инструмент: ${name}`);
  }
  if (rawArgs !== undefined && (typeof rawArgs !== 'object' || rawArgs === null || Array.isArray(rawArgs))) {
    return error(id, JSON_RPC_ERRORS.INVALID_PARAMS, 'params.arguments должен быть объектом');
  }
  const parsed = tool.argsSchema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return error(id, JSON_RPC_ERRORS.INVALID_PARAMS, `Некорректные аргументы инструмента ${name}: ${parsed.error.message}`);
  }

  try {
    const result = await tool.run(userId, parsed.data);
    return success(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
  } catch (err) {
    // Ошибка выполнения инструмента (например, задача не найдена/чужая) — это результат
    // вызова инструмента по протоколу MCP, а не протокольная ошибка JSON-RPC.
    return success(id, {
      content: [{ type: 'text', text: err instanceof Error ? err.message : 'Инструмент завершился с ошибкой' }],
      isError: true,
    });
  }
}

/**
 * Точка входа MCP. `userId` — уже аутентифицированный пользователь (HTTP-слой
 * гарантирует его наличие через requireAuth до вызова этой функции). Никогда
 * не бросает исключение — любой сбой оформляется как JSON-RPC error object.
 */
export async function handleMcp(body: unknown, userId: number): Promise<JsonRpcResponse> {
  const id = extractId(body);

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return error(id, JSON_RPC_ERRORS.INVALID_REQUEST, 'Тело запроса должно быть JSON-RPC объектом');
  }
  const req = body as { jsonrpc?: unknown; method?: unknown; params?: unknown };
  if (typeof req.method !== 'string' || req.method.length === 0) {
    return error(id, JSON_RPC_ERRORS.INVALID_REQUEST, 'Поле method должно быть непустой строкой');
  }

  try {
    switch (req.method) {
      case 'initialize':
        return success(id, {
          protocolVersion: PROTOCOL_VERSION,
          serverInfo: SERVER_INFO,
          capabilities: { tools: {} },
        });
      case 'tools/list':
        return success(id, {
          tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
        });
      case 'tools/call':
        return await handleToolsCall(id, userId, req.params);
      // notifications/initialized и подобные уведомления клиент может прислать без ожидания
      // ответа — отвечаем пустым результатом, чтобы не шуметь ошибкой -32601 в логах клиента.
      case 'notifications/initialized':
      case 'ping':
        return success(id, {});
      default:
        return error(id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Unknown method: ${req.method}`);
    }
  } catch (err) {
    // Защита в глубину: даже непредвиденное исключение внутри метода не должно
    // долетать до вызывающего кода как throw — демо не должно падать.
    return error(id, JSON_RPC_ERRORS.INTERNAL_ERROR, err instanceof Error ? err.message : 'Internal error');
  }
}
