import express from 'express';
import cors from 'cors';
import { config } from './config';
import { router } from './routes';
import { initDb } from './db/db';
import { seedDb } from './db/seed';
import { searchService } from './services/search.service';
import { telegramService } from './services/telegram.service';
import { startNotificationScheduler } from './services/notification.service';

const app = express();

app.use(cors());
app.use(express.json({ limit: `${config.maxFileSizeMb}mb` }));
app.use(express.urlencoded({ extended: true }));

app.use('/v1', router);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

async function start(): Promise<void> {
  initDb();
  seedDb();
  searchService.reindexAll();
  searchService.startVaultWatcher();
  telegramService.start();
  startNotificationScheduler();
  app.listen(config.port, () => {
    console.log(`[PIS API] running on port ${config.port}`);
  });
}

start().catch((err) => {
  console.error('[PIS API] startup error:', err);
  process.exit(1);
});

export { app };
