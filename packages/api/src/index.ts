import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { router } from './routes';
import { initPg, runSchema } from './db/db';
import { seedDb } from './db/seed';
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
  searchService.reindexAll();
  searchService.startVaultWatcher();
  telegramService.start();
  startNotificationScheduler();
  app.listen(config.port, () => {
    console.log(`[Clarity Space API] running on port ${config.port}`);
    // Start Obsidian vault watcher for bidirectional sync
    startVaultWatcher(null);
  });
}

start().catch((err) => {
  console.error('[Clarity Space API] startup error:', err);
  process.exit(1);
});

export { app };
