import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { router } from './routes';
import { initPg, runSchema } from './db/db';
import { seedDb } from './db/seed';
import { seedAdvisors } from './db/advisors.seed';
import { searchService } from './services/search.service';
import { telegramService } from './services/telegram.service';
import { startNotificationScheduler } from './services/notification.service';
import { authMiddleware } from './middleware/auth';
import { startVaultWatcher } from './services/obsidian-sync.service';

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
app.use('/v1/', rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please try again later.' },
}));

// Stricter rate limit for auth endpoints — 10 per minute
app.use('/v1/auth/', rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many auth attempts. Please try again later.' },
}));

app.use(authMiddleware);

app.use('/v1', router);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
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
