import 'dotenv/config';
import { startBot } from './bot.js';

startBot().catch((err) => {
  console.error('[claude-ops-bot] fatal:', err);
  process.exit(1);
});
