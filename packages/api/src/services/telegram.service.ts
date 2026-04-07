import { Telegraf, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import { config } from '../config';
import { getDb } from '../db/db';
import { IngestService } from './ingest.service';

export class TelegramService {
  private bot: Telegraf | null = null;

  start(): void {
    if (!config.telegramBotToken) {
      console.log('[telegram] no token, bot disabled');
      return;
    }

    this.bot = new Telegraf(config.telegramBotToken);

    // /start
    this.bot.command('start', (ctx) => {
      const text =
        '🚀 Бот готов к работе!\n\n' +
        'Команды:\n' +
        '/tasks — активные задачи\n' +
        '/all — все задачи по статусам\n' +
        '/projects — список проектов\n' +
        '/add <название> — быстро добавить задачу\n' +
        '/brief — дневной брифинг\n' +
        '/search <запрос> — поиск\n' +
        '/app — открыть приложение\n\n' +
        'Отправь текст, голосовое или файл → попадёт в Inbox';

      if (config.webappUrl) {
        ctx.reply(text, Markup.inlineKeyboard([
          Markup.button.webApp('📱 Открыть приложение', config.webappUrl),
        ]));
      } else {
        ctx.reply(text);
      }
    });

    // /app — open Mini App
    this.bot.command('app', (ctx) => {
      if (!config.webappUrl) {
        ctx.reply('⚠️ URL приложения не настроен (WEBAPP_URL)');
        return;
      }
      ctx.reply('📱 Открыть приложение:', Markup.inlineKeyboard([
        Markup.button.webApp('Открыть', config.webappUrl),
      ]));
    });

    // /tasks — today's tasks
    this.bot.command('tasks', (ctx) => {
      const db = getDb();
      const tasks = db.prepare(
        "SELECT title, status, priority, due_date, project_id FROM tasks WHERE archived = 0 AND status NOT IN ('done', 'someday') ORDER BY priority DESC LIMIT 20"
      ).all() as Array<{ title: string; status: string; priority: number; due_date: string | null; project_id: number | null }>;

      if (tasks.length === 0) {
        ctx.reply('Нет активных задач!');
        return;
      }

      const projectMap = new Map(
        (db.prepare('SELECT id, name FROM projects').all() as Array<{ id: number; name: string }>).map(p => [p.id, p.name])
      );

      const lines = tasks.map((t) => {
        const status = t.status === 'done' ? '✅' : t.status === 'in_progress' ? '🔄' : '📋';
        const priority = '⭐'.repeat(Math.min(t.priority, 5));
        const project = t.project_id ? `[${projectMap.get(t.project_id) ?? '?'}]` : '';
        const due = t.due_date ? ` 📅${t.due_date}` : '';
        return `${status} ${t.title} ${project}${due}\n   ${priority}`;
      });

      ctx.reply(`📋 Активные задачи:\n\n${lines.join('\n\n')}`);
    });

    // /all — all tasks grouped by status
    this.bot.command('all', (ctx) => {
      const db = getDb();
      const tasks = db.prepare(
        "SELECT title, status, priority FROM tasks WHERE archived = 0 ORDER BY status, priority DESC"
      ).all() as Array<{ title: string; status: string; priority: number }>;

      const grouped: Record<string, string[]> = {};
      for (const t of tasks) {
        if (!grouped[t.status]) grouped[t.status] = [];
        grouped[t.status]!.push(`  • ${t.title} ${'⭐'.repeat(t.priority)}`);
      }

      const statusLabels: Record<string, string> = {
        backlog: '📥 Бэклог', todo: '📋 К выполнению', in_progress: '🔄 В работе',
        done: '✅ Готово', someday: '🔮 Когда-нибудь'
      };

      const text = Object.entries(grouped)
        .map(([status, items]) => `${statusLabels[status] ?? status}\n${items.join('\n')}`)
        .join('\n\n');

      ctx.reply(text || 'Нет задач');
    });

    // /projects
    this.bot.command('projects', (ctx) => {
      const projects = getDb().prepare(
        "SELECT name, status, color FROM projects WHERE archived = 0 ORDER BY order_index ASC"
      ).all() as Array<{ name: string; status: string }>;

      const lines = projects.map(p => `• ${p.name} (${p.status})`);
      ctx.reply(`📁 Проекты:\n\n${lines.join('\n')}` || 'Нет проектов');
    });

    // /add <title> — quick add task
    this.bot.command('add', (ctx) => {
      const text = ctx.message.text.replace(/^\/add\s*/, '').trim();
      if (!text) { ctx.reply('Формат: /add Название задачи'); return; }

      getDb().prepare('INSERT INTO tasks (title, status, priority) VALUES (?, ?, ?)').run(text, 'todo', 3);
      ctx.reply(`✅ Задача добавлена: ${text}`);
    });

    // /brief — daily brief
    this.bot.command('brief', async (ctx) => {
      const db = getDb();
      const today = new Date().toISOString().split('T')[0];
      const tasks = db.prepare(
        "SELECT title, status, priority, due_date FROM tasks WHERE archived = 0 AND status NOT IN ('done', 'someday') ORDER BY priority DESC LIMIT 10"
      ).all();
      const meetings = db.prepare(
        'SELECT title, date FROM meetings WHERE date >= ? ORDER BY date ASC LIMIT 5'
      ).all(today);

      let brief = '🌅 Дневной брифинг\n\n';
      brief += `📋 Активных задач: ${(tasks as Array<unknown>).length}\n`;
      brief += `📅 Предстоящих встреч: ${(meetings as Array<unknown>).length}\n\n`;

      if ((tasks as Array<{ title: string }>).length > 0) {
        brief += 'Приоритетные задачи:\n';
        for (const t of tasks as Array<{ title: string; priority: number }>) {
          brief += `  • ${t.title} ${'⭐'.repeat(t.priority)}\n`;
        }
      }

      ctx.reply(brief);
    });

    // /search <query>
    this.bot.command('search', (ctx) => {
      const query = ctx.message.text.replace(/^\/search\s*/, '').trim();
      if (!query) { ctx.reply('Формат: /search ключевое слово'); return; }

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { searchService } = require('./search.service');
      const results = searchService.search(query, 10);
      if (results.length === 0) { ctx.reply('Ничего не найдено'); return; }

      const lines = results.map((r: { type: string; title: string }) => `[${r.type}] ${r.title}`);
      ctx.reply(`🔍 Результаты:\n\n${lines.join('\n')}`);
    });

    // Format ingest result nicely
    const formatIngestResult = (result: { detected_type: string; summary: string; created_records: Array<{ type: string; id: number; title: string }> }): string => {
      const typeLabels: Record<string, string> = { meeting: '🤝 Встреча', task: '📋 Задача', idea: '💡 Идея', inbox: '📥 Входящее' };
      const label = typeLabels[result.detected_type] ?? result.detected_type;
      let msg = `${label}: ${result.summary}`;
      if (result.created_records?.length > 0) {
        for (const rec of result.created_records) {
          msg += `\n  → ${rec.type} #${rec.id}: ${rec.title}`;
        }
        // Show linked project/people
        const db = getDb();
        for (const rec of result.created_records) {
          if (rec.type === 'meeting') {
            const m = db.prepare('SELECT project_id FROM meetings WHERE id = ?').get(rec.id) as { project_id: number | null } | undefined;
            if (m?.project_id) {
              const p = db.prepare('SELECT name FROM projects WHERE id = ?').get(m.project_id) as { name: string } | undefined;
              if (p) msg += `\n  📁 Проект: ${p.name}`;
            }
            const people = db.prepare('SELECT p.name FROM people p JOIN meeting_people mp ON p.id = mp.person_id WHERE mp.meeting_id = ?').all(rec.id) as Array<{ name: string }>;
            if (people.length > 0) msg += `\n  👥 Участники: ${people.map(p => p.name).join(', ')}`;
          }
          if (rec.type === 'task') {
            const t = db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(rec.id) as { project_id: number | null } | undefined;
            if (t?.project_id) {
              const p = db.prepare('SELECT name FROM projects WHERE id = ?').get(t.project_id) as { name: string } | undefined;
              if (p) msg += `\n  📁 Проект: ${p.name}`;
            }
          }
        }
      }
      return msg;
    };

    // Any text message → smart ingest
    this.bot.on(message('text'), async (ctx) => {
      if (ctx.message.text.startsWith('/')) return;
      try {
        const ingestService = new IngestService();
        const result = await ingestService.ingestText(ctx.message.text);
        ctx.reply(formatIngestResult(result));
      } catch (err) {
        ctx.reply(`❌ Ошибка: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    });

    // Voice message → transcribe + smart ingest
    this.bot.on(message('voice'), async (ctx) => {
      try {
        ctx.reply('🎤 Транскрибирую...');
        const fileId = ctx.message.voice.file_id;
        const fileLink = await ctx.telegram.getFileLink(fileId);
        const response = await fetch(fileLink.href);
        const buffer = Buffer.from(await response.arrayBuffer());

        const ingestService = new IngestService();
        const result = await ingestService.ingestBuffer(buffer, 'voice.ogg');
        ctx.reply(formatIngestResult(result));
      } catch (err) {
        ctx.reply(`❌ Ошибка: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    });

    // Document → smart ingest
    this.bot.on(message('document'), async (ctx) => {
      try {
        ctx.reply('📄 Обрабатываю файл...');
        const doc = ctx.message.document;
        const fileLink = await ctx.telegram.getFileLink(doc.file_id);
        const response = await fetch(fileLink.href);
        const buffer = Buffer.from(await response.arrayBuffer());

        const ingestService = new IngestService();
        const result = await ingestService.ingestBuffer(buffer, doc.file_name ?? 'file');
        ctx.reply(formatIngestResult(result));
      } catch (err) {
        ctx.reply(`❌ Ошибка: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    });

    this.bot.on(message('photo'), async (ctx) => {
      try {
        const photo = ctx.message.photo[ctx.message.photo.length - 1]!;
        const fileLink = await ctx.telegram.getFileLink(photo.file_id);
        const response = await fetch(fileLink.href);
        const buffer = Buffer.from(await response.arrayBuffer());

        const ingestService = new IngestService();
        const result = await ingestService.ingestBuffer(buffer, 'photo.jpg');
        ctx.reply(`📷 Фото обработано: ${result.detected_type}\n${result.summary}`);
      } catch (err) {
        ctx.reply(`❌ Error: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    });

    this.bot.launch().then(() => {
      console.log('[telegram] bot started');
    }).catch((err) => {
      console.error('[telegram] bot failed to start:', err.message);
    });

    // Graceful shutdown
    process.once('SIGINT', () => this.bot?.stop('SIGINT'));
    process.once('SIGTERM', () => this.bot?.stop('SIGTERM'));
  }

  /** Send a notification message to the configured user */
  async notify(message: string): Promise<void> {
    if (!this.bot || !config.telegramUserId) return;
    try {
      await this.bot.telegram.sendMessage(config.telegramUserId, message, { parse_mode: 'HTML' });
    } catch (err) {
      console.error('[telegram] notify failed:', err);
    }
  }
}

export const telegramService = new TelegramService();
