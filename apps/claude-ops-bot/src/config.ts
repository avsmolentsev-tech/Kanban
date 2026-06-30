import * as path from 'node:path';
import * as os from 'node:os';

export interface OpsConfig {
  telegramToken: string;
  allowedTgId: number;
  stateDir: string;
  dbPath: string;
  sessionTimeoutMs: number;
  defaultModel: 'sonnet' | 'opus';
  claudeBin: string;
  maxConcurrentTasks: number;
  fastifyPort: number;
  verifyCommand: string;
  miniappUrl: string;
}

export function loadConfig(): OpsConfig {
  const token = process.env.TELEGRAM_OPS_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_OPS_BOT_TOKEN is required');

  const idStr = process.env.ALLOWED_TG_ID ?? '';
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) throw new Error('ALLOWED_TG_ID must be a positive integer');

  const rawStateDir = process.env.CLAUDE_OPS_STATE_DIR ?? path.join(os.homedir(), '.claude-ops');
  const stateDir = rawStateDir.startsWith('~')
    ? path.join(os.homedir(), rawStateDir.slice(1))
    : rawStateDir;

  const timeoutMin = Number(process.env.SESSION_TIMEOUT_MINUTES ?? 30);
  const model = (process.env.DEFAULT_MODEL ?? 'sonnet') as 'sonnet' | 'opus';

  return {
    telegramToken: token,
    allowedTgId: id,
    stateDir,
    dbPath: process.env.DB_PATH ?? path.join(stateDir, 'forge.db'),
    sessionTimeoutMs: timeoutMin * 60_000,
    defaultModel: model,
    claudeBin: process.env.CLAUDE_BIN ?? 'claude',
    maxConcurrentTasks: Number(process.env.MAX_CONCURRENT_TASKS ?? 3),
    fastifyPort: Number(process.env.FASTIFY_PORT ?? 8787),
    verifyCommand: process.env.VERIFY_COMMAND ?? 'npm run verify',
    miniappUrl: process.env.MINIAPP_URL ?? 'https://forge.myaipro.ru',
  };
}
