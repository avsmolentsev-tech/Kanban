import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export const config = {
  port: parseInt(process.env['PORT'] ?? '3001', 10),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  anthropicApiKey: process.env['ANTHROPIC_API_KEY'] ?? '',
  vaultPath: process.env['VAULT_PATH'] ?? path.resolve(process.cwd(), '../../vault'),
  databasePath: process.env['DATABASE_PATH'] ?? path.resolve(process.cwd(), '../../data/pis.db'),
  openaiApiKey: process.env['OPENAI_API_KEY'] ?? '',
  maxFileSizeMb: parseInt(process.env['MAX_FILE_SIZE_MB'] ?? '50', 10),
  telegramBotToken: process.env['TELEGRAM_BOT_TOKEN'] ?? '',
  telegramUserId: process.env['TELEGRAM_USER_ID'] ?? '',
  webappUrl: process.env['WEBAPP_URL'] ?? '',
} as const;
