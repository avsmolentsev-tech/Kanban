import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { apiRateLimit, authRateLimit, healthRateLimit, mcpRateLimit } from './middleware/rate-limit';
import { config } from './config';
import { router } from './routes';
import { initPg, runSchema } from './db/db';
import { seedDb } from './db/seed';
import { seedAdvisors } from './db/advisors.seed';
import { searchService } from './services/search.service';
import { telegramService } from './services/telegram.service';
import { startNotificationScheduler } from './services/notification.service';
import { authMiddleware, requireAuth, AuthRequest } from './middleware/auth';
import { getUserId } from './middleware/user-scope';
import { startVaultWatcher } from './services/obsidian-sync.service';
import { checkHealth } from './services/health.service';
import { handleMcp } from './routes/mcp';

// Catch-all crash protection — log and keep running
process.on('uncaughtException', (err) => {
  console.error('[FATAL uncaughtException]', err?.stack || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL unhandledRejection]', reason);
});

const app = express();
app.set('trust proxy', 1);

// Security headers (HSTS, nosniff, frameguard, etc.). CSP is disabled here — the
// API serves JSON + file downloads, not HTML pages — and attachment routes force
// download + nosniff to neutralize any uploaded HTML/SVG. cross-origin resource
// policy stays open so the SPA can embed attachment images.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
  origin: ['https://clarity-space.ru', 'http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
}));
app.use(express.json({ limit: `${config.maxFileSizeMb}mb` }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting — 200 requests per minute per IP
app.use('/v1/', apiRateLimit);

// Stricter rate limit for auth endpoints — 10 per minute
app.use('/v1/auth/', authRateLimit);

app.use(authMiddleware);

app.use('/v1', router);

// /health и /mcp объявлены вне app.use('/v1/', ...) выше — путь-скоупнутый
// общий лимитер их не покрывает (F1). У каждого свой лимит на IP: /health
// бьёт по Postgres и делает исходящий вызов к сервису транскрипции на каждый
// хит, /mcp читает/пишет через несколько запросов на вызов инструмента —
// без лимита оба открыты для шторма прямо мимо общего REST-лимита.
app.get('/health', healthRateLimit, async (_req, res) => {
  const report = await checkHealth();
  res.status(report.status === 'down' ? 503 : 200).json(report);
});

// MCP-эндпоинт (Model Context Protocol) — вне /v1, как и /health: это отдельный
// протокол (JSON-RPC 2.0), а не часть REST-конверта { success, data }. Тот же
// Bearer cs_... токен, что и остальной API — requireAuth уже отклоняет запрос
// без валидного токена 401-м до того, как тело дойдёт до handleMcp.
app.post('/mcp', mcpRateLimit, requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  if (userId == null) {
    // requireAuth гарантирует req.user, но перестраховка на случай будущих изменений
    // middleware — MCP не должен выполнить ни одного инструмента без пользователя.
    res.status(401).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Authentication required' } });
    return;
  }
  const result = await handleMcp(req.body, userId);
  res.json(result);
});

// Тело POST /mcp с синтаксически невалидным JSON роняется express.json() раньше,
// чем запрос доходит до маршрута выше — здесь превращаем это в валидный JSON-RPC
// parse error вместо HTML-страницы дефолтного обработчика ошибок Express.
app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  const isBodyParseError = err && typeof err === 'object' && 'type' in err && (err as { type?: string }).type === 'entity.parse.failed';
  if (isBodyParseError && req.path === '/mcp') {
    res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error: invalid JSON' } });
    return;
  }
  next(err);
});

async function start(): Promise<void> {
  await initPg(config.databaseUrl);
  await runSchema();
  seedDb();
  await seedAdvisors();
  searchService.reindexAll();
  searchService.startVaultWatcher();
  telegramService.start();
  startNotificationScheduler();
  // Todoist background sync
  try { const { startTodoistBackgroundSync } = require('./routes/todoist'); startTodoistBackgroundSync(); } catch (e) { console.warn('[todoist] background sync not started:', (e as Error).message); }
  app.listen(config.port, () => {
    console.log(`[Clarity Space API] running on port ${config.port}`);
    // Догоняем расшифровки, оборванные прошлым перезапуском. Асинхронно и после
    // listen: восстановление не должно задерживать подъём API.
    void (async () => {
      try {
        const { resumeInterruptedTranscriptions } = require('./routes/meetings');
        await resumeInterruptedTranscriptions();
      } catch (e) {
        console.warn('[jobs] восстановление не запустилось:', (e as Error).message);
      }
    })();
    // Start Obsidian vault watcher for bidirectional sync
    startVaultWatcher(null);
  });
}

start().catch((err) => {
  console.error('[Clarity Space API] startup error:', err);
  process.exit(1);
});

export { app };
