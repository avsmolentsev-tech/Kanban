import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export const config = {
  port: parseInt(process.env['PORT'] ?? '3001', 10),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  anthropicApiKey: process.env['ANTHROPIC_API_KEY'] ?? '',
  vaultPath: process.env['VAULT_PATH'] ?? path.resolve(process.cwd(), '../../vault'),
  databasePath: process.env['DATABASE_PATH'] ?? path.resolve(process.cwd(), '../../data/pis.db'),
  databaseUrl: process.env['DATABASE_URL'] ?? '',
  openaiApiKey: process.env['OPENAI_API_KEY'] ?? '',
  openaiBaseUrl: process.env['OPENAI_BASE_URL'] || undefined,
  // Separate key/model for the Advisory Board (own billing/limits). Falls back to the main key.
  advisorApiKey: process.env['ADVISOR_OPENAI_API_KEY'] || '',
  advisorModel: process.env['ADVISOR_MODEL'] || 'gpt-4.1-mini',
  maxFileSizeMb: parseInt(process.env['MAX_FILE_SIZE_MB'] ?? '50', 10),
  telegramBotToken: process.env['TELEGRAM_BOT_TOKEN'] ?? '',
  telegramUserId: process.env['TELEGRAM_USER_ID'] ?? '',
  webappUrl: process.env['WEBAPP_URL'] ?? '',
  googleClientId: process.env['GOOGLE_CLIENT_ID'] ?? '',
  googleClientSecret: process.env['GOOGLE_CLIENT_SECRET'] ?? '',
  todoistClientId: process.env['TODOIST_CLIENT_ID'] ?? '',
  todoistClientSecret: process.env['TODOIST_CLIENT_SECRET'] ?? '',
  yandexClientId: process.env['YANDEX_CLIENT_ID'] ?? '',
  yandexClientSecret: process.env['YANDEX_CLIENT_SECRET'] ?? '',
  jwtSecret: process.env['JWT_SECRET'] ?? 'pis-default-secret-change-me',
  resendApiKey: process.env['RESEND_API_KEY'] ?? '',
  emailFrom: process.env['EMAIL_FROM'] ?? 'Clarity Space <noreply@clarity-space.ru>',
} as const;

if (config.jwtSecret === 'pis-default-secret-change-me') {
  if (config.nodeEnv === 'production') {
    console.error('[SECURITY] FATAL: JWT_SECRET not set in production! Refusing to start.');
    process.exit(1);
  }
  console.warn('[SECURITY] WARNING: Using default JWT secret! Set JWT_SECRET in .env');
}
