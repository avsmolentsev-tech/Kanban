import { Telegraf, Context } from 'telegraf';
import { message } from 'telegraf/filters';
import * as path from 'node:path';
import * as fs from 'fs-extra';
import { loadConfig } from './config.js';
import { makeAuthMiddleware } from './auth.js';
import { SessionManager } from './session.js';
import { ProjectResolver } from './project-resolver.js';
import { ensureDirs } from './state-store.js';
import { ClaudeRunner } from './claude-runner.js';
import { chunkForTelegram } from './tg-format.js';
import { transcribe } from './whisper.js';

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

  const MODEL_FLAG = (m: 'sonnet' | 'opus') => m === 'opus' ? 'claude-opus-4-6' : 'claude-sonnet-4-6';

  bot.command('stop', (ctx) => {
    const s = sessions.get(ctx.from!.id);
    const runner = s.claudeProcess as ClaudeRunner | undefined;
    if (!runner || !runner.isRunning()) return ctx.reply('Сейчас ничего не выполняется.');
    runner.stop();
    return ctx.reply('⏹ отправлен SIGINT');
  });

  bot.command('status', (ctx) => {
    const s = sessions.get(ctx.from!.id);
    if (!s.activeTarget) return ctx.reply('Сессия без активного проекта.');
    const runner = s.claudeProcess as ClaudeRunner | undefined;
    const running = runner?.isRunning() ? 'работает' : 'idle';
    const age = Math.round((Date.now() - s.lastActivityTs) / 1000);
    return ctx.reply(`Проект: ${s.activeTarget.name}\nМодель: ${s.model}\nСтатус: ${running}\nИнактив: ${age}с`);
  });

  bot.command('opus', (ctx) => {
    const s = sessions.get(ctx.from!.id);
    s.model = 'opus';
    return ctx.reply('Следующий раунд: Opus');
  });

  bot.on('text', async (ctx) => {
    const tgId = ctx.from!.id;
    const text = ctx.message.text;
    if (text.startsWith('/')) return; // commands handled above

    const s = sessions.get(tgId);
    sessions.touch(tgId);

    if (!s.activeTarget) {
      const list = resolver.list();
      if (list.length === 1 && list[0]) {
        s.activeTarget = list[0];
        await ctx.reply(`Активный: ${list[0].name} (единственный в whitelist)`);
      } else if (list.length === 0) {
        await ctx.reply('Whitelist пуст. /add_repo <path>');
        return;
      } else {
        await ctx.reply('Какой проект? ' + list.map((t) => `/use ${t.name}`).join(' или '));
        return;
      }
    }

    await ctx.reply(`🚀 ${s.activeTarget!.name} (${s.model}) старт`);

    const runner = new ClaudeRunner({
      bin: cfg.claudeBin,
      args: ['-p', '--permission-mode', 'bypassPermissions', '--model', MODEL_FLAG(s.model)],
      cwd: s.activeTarget!.path,
    });
    s.claudeProcess = runner;

    let buf = '';
    const flush = async (): Promise<void> => {
      if (!buf) return;
      const toSend = buf;
      buf = '';
      for (const chunk of chunkForTelegram(toSend)) {
        await ctx.reply(chunk).catch(() => {});
      }
    };
    const flushTimer = setInterval(flush, 2000);

    try {
      const res = await runner.run(text, (c) => { buf += c; });
      clearInterval(flushTimer);
      await flush();
      await ctx.reply(res.exitCode === 0 ? `✅ раунд завершён` : `⚠️ exit ${res.exitCode}`);
    } catch (err) {
      clearInterval(flushTimer);
      await ctx.reply(`❌ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      s.claudeProcess = undefined;
      sessions.touch(tgId);
    }
  });

  async function dispatchText(ctx: Context, text: string): Promise<void> {
    // Re-enter the text flow manually by constructing a minimal Update and replaying it.
    const fakeMessage = { ...(ctx.message as any), text };
    await bot.handleUpdate({ update_id: 0, message: fakeMessage } as any);
  }

  bot.on(message('voice'), async (ctx) => {
    try {
      await ctx.reply('🎤 Транскрибирую...');
      const fileId = ctx.message.voice.file_id;
      const link = await ctx.telegram.getFileLink(fileId);
      const res = await fetch(link.href);
      const buf = Buffer.from(await res.arrayBuffer());
      const text = await transcribe(buf, 'voice.ogg');
      if (!text.trim()) { await ctx.reply('⚠️ пусто'); return; }
      await ctx.reply(`📝 ${text.slice(0, 500)}${text.length > 500 ? '…' : ''}`);
      await dispatchText(ctx, text);
    } catch (err) {
      await ctx.reply(`❌ ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  bot.on(message('document'), async (ctx) => {
    try {
      const doc = ctx.message.document;
      const link = await ctx.telegram.getFileLink(doc.file_id);
      const res = await fetch(link.href);
      const buf = Buffer.from(await res.arrayBuffer());
      const outDir = path.join(cfg.stateDir, 'inputs', String(ctx.from!.id));
      await fs.mkdirp(outDir);
      const outPath = path.join(outDir, `${Date.now()}-${doc.file_name ?? 'file'}`);
      await fs.writeFile(outPath, buf);
      await ctx.reply(`📎 сохранён: ${outPath}`);
      await dispatchText(ctx, `Файл доступен локально: ${outPath}\n\n${ctx.message.caption ?? 'Посмотри и действуй.'}`);
    } catch (err) {
      await ctx.reply(`❌ ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  bot.on(message('photo'), async (ctx) => {
    try {
      const photo = ctx.message.photo[ctx.message.photo.length - 1]!;
      const link = await ctx.telegram.getFileLink(photo.file_id);
      const res = await fetch(link.href);
      const buf = Buffer.from(await res.arrayBuffer());
      const outDir = path.join(cfg.stateDir, 'inputs', String(ctx.from!.id));
      await fs.mkdirp(outDir);
      const outPath = path.join(outDir, `${Date.now()}-photo.jpg`);
      await fs.writeFile(outPath, buf);
      await dispatchText(ctx, `Скриншот: ${outPath}\n\n${ctx.message.caption ?? 'Проанализируй.'}`);
    } catch (err) {
      await ctx.reply(`❌ ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  bot.catch((err) => console.error('[claude-ops-bot] handler error:', err));

  await bot.launch();
  console.log('[claude-ops-bot] started');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
