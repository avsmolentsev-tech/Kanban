import { Telegraf } from 'telegraf';
import * as path from 'node:path';
import { loadConfig } from './config.js';
import { makeAuthMiddleware } from './auth.js';
import { SessionManager } from './session.js';
import { ProjectResolver } from './project-resolver.js';
import { ensureDirs } from './state-store.js';

export async function startBot(): Promise<void> {
  const cfg = loadConfig();
  await ensureDirs(cfg.stateDir);

  const resolver = new ProjectResolver(path.join(cfg.stateDir, 'repos.json'));
  await resolver.load();

  const sessions = new SessionManager({ timeoutMs: cfg.sessionTimeoutMs, defaultModel: cfg.defaultModel });

  const bot = new Telegraf(cfg.telegramToken, { handlerTimeout: Infinity });
  bot.use(makeAuthMiddleware(cfg.allowedTgId));

  bot.command('start', (ctx) => ctx.reply('Claude Ops bot готов. /repos — список, /add-repo <абсолютный путь> — добавить.'));

  bot.command('repos', (ctx) => {
    const s = sessions.get(ctx.from!.id);
    const list = resolver.list();
    if (list.length === 0) return ctx.reply('Whitelist пуст. /add-repo <path>');
    const lines = list.map((t) => {
      const mark = t.name === s.activeTarget?.name ? '● ' : '  ';
      return `${mark}${t.name} (${t.type}) — ${t.path}`;
    });
    return ctx.reply(lines.join('\n'));
  });

  bot.command('use', async (ctx) => {
    const name = ctx.message.text.replace(/^\/use\s*/, '').trim();
    const target = resolver.get(name);
    if (!target) return ctx.reply(`Нет '${name}'. /repos для списка.`);
    const s = sessions.get(ctx.from!.id);
    s.activeTarget = target;
    sessions.touch(ctx.from!.id);
    return ctx.reply(`Активный: ${target.name} (${target.type}) — ${target.path}`);
  });

  bot.command('add_repo', async (ctx) => {
    const arg = ctx.message.text.replace(/^\/add_repo\s*/, '').trim();
    const parts = arg.split(/\s+/).filter(Boolean);
    const p = parts[0], name = parts[1] ?? path.basename(parts[0] ?? '');
    if (!p) return ctx.reply('Формат: /add_repo <absolute_path> [name]');
    try {
      const t = await resolver.addRepo(p, name);
      return ctx.reply(`✅ ${t.name} (${t.type}) добавлен`);
    } catch (err) {
      return ctx.reply(`❌ ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  bot.command('end', (ctx) => {
    sessions.end(ctx.from!.id);
    return ctx.reply('Сессия закрыта.');
  });

  bot.catch((err) => console.error('[claude-ops-bot] handler error:', err));

  await bot.launch();
  console.log('[claude-ops-bot] started');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
