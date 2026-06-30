import 'dotenv/config';
import { loadConfig } from './config.js';
import { getDb } from './db.js';
import { startBot } from './bot.js';

const cfg = loadConfig();
const db = getDb(cfg.dbPath);

startBot(cfg, db).catch((err) => {
  console.error('[forge] fatal:', err);
  process.exit(1);
});
