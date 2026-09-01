import rateLimit from 'express-rate-limit';

// Общие настройки лимитеров вынесены в отдельный модуль (а не заданы инлайном
// в index.ts), чтобы их можно было проверить тестами: index.ts вызывает
// start() (реальное подключение к Postgres) на верхнем уровне модуля, поэтому
// его нельзя безопасно импортировать в jest — а этот файл можно.

const WINDOW_MS = 60 * 1000;

/** Общий REST-лимит: 200 запросов/мин на IP. */
export const API_RATE_LIMIT_MAX = 200;
/** Лимит для /v1/auth/*: 10 запросов/мин на IP — защита от перебора пароля. */
export const AUTH_RATE_LIMIT_MAX = 10;
/**
 * /health — публичный, без авторизации, опрашивается системой мониторинга
 * (обычно раз в 10–30 секунд). Каждый хит бьёт по Postgres и делает исходящий
 * HTTP-вызов к микросервису транскрипции (services/health.service.ts) — это
 * не бесплатная операция, и без лимита эндпоинт вне /v1/ (а значит, вне
 * общего REST-лимитера в index.ts) можно было дёргать без ограничений.
 * 30/мин — с запасом на несколько параллельных систем мониторинга поверх
 * типичного интервала опроса, но всё же кап на шторм/DoS.
 */
export const HEALTH_RATE_LIMIT_MAX = 30;
/**
 * /mcp — тоже вне /v1/, тоже мимо общего REST-лимитера. В отличие от /health,
 * им управляет не автоматика, а человек через редактор (Claude Code) — сессия
 * из нескольких вызовов инструментов подряд легитимна и не должна упираться в
 * лимит. Но каждый вызов инструмента может стоить нескольких запросов к БД
 * (list_tasks — обогащение people/subtasks/tags/dependencies, search_vault —
 * пять запросов, включая неиндексируемые ILIKE-сканы) — лимит выше, чем
 * реалистичная скорость работы человека, но не бесконечный.
 */
export const MCP_RATE_LIMIT_MAX = 60;

/** Стандартный REST-конверт { success: false, error } — как у остального /v1/. */
const REST_MESSAGE = { success: false, error: 'Too many requests. Please try again later.' };
const REST_AUTH_MESSAGE = { success: false, error: 'Too many auth attempts. Please try again later.' };
/** JSON-RPC 2.0 форма ошибки — /mcp не REST-конверт, см. index.ts и openapi.yaml. */
const MCP_MESSAGE = {
  jsonrpc: '2.0',
  id: null,
  error: { code: -32000, message: 'Too many requests. Please try again later.' },
};

function build(max: number, message: unknown) {
  return rateLimit({
    windowMs: WINDOW_MS,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message,
  });
}

export const apiRateLimit = build(API_RATE_LIMIT_MAX, REST_MESSAGE);
export const authRateLimit = build(AUTH_RATE_LIMIT_MAX, REST_AUTH_MESSAGE);
export const healthRateLimit = build(HEALTH_RATE_LIMIT_MAX, REST_MESSAGE);
export const mcpRateLimit = build(MCP_RATE_LIMIT_MAX, MCP_MESSAGE);
