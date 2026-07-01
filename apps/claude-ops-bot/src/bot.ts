import { Telegraf, Context, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import * as path from 'node:path';
import fs from 'fs-extra';
import type Database from 'better-sqlite3';
import { type OpsConfig } from './config.js';
import { makeAuthMiddleware } from './auth.js';
import { ProjectResolver } from './project-resolver.js';
import { ensureDirs } from './state-store.js';
import { ClaudeRunner } from './claude-runner.js';
import { chunkForTelegram } from './tg-format.js';
import { transcribe } from './whisper.js';
import { createTask, updateTask, getTask, getActiveTasks, addEvent } from './db.js';
import { TaskManager, createWorktree, getWorktreeDiffStat, type TaskState } from './task-manager.js';
import { projectKeyboard, modelKeyboard, planGateKeyboard, doneKeyboard, failedKeyboard, workingKeyboard, activeTasksKeyboard } from './keyboards.js';
import { formatReport, formatFailed, formatPlan } from './report.js';
import { runVerify, formatVerifyResult } from './verify.js';
import { buildPlanPrompt, buildExecutePrompt, extractPlan, extractSummary } from './plan-parser.js';

const MODEL_FLAG = (m: 'sonnet' | 'opus') => m === 'opus' ? 'claude-opus-4-6' : 'claude-sonnet-4-6';

const PROJECTS_DIR = '/root/projects';

interface PendingTask {
  prompt: string;
  model: 'sonnet' | 'opus';
  target: 'server' | 'desktop';
  projectName?: string;
}

export async function startBot(cfg: OpsConfig, db: Database.Database): Promise<void> {
  await ensureDirs(cfg.stateDir);

  const resolver = new ProjectResolver(path.join(cfg.stateDir, 'repos.json'));
  await resolver.load();

  const taskMgr = new TaskManager({ db, maxConcurrent: cfg.maxConcurrentTasks, claudeBin: cfg.claudeBin });

  const bot = new Telegraf(cfg.telegramToken, { handlerTimeout: Infinity });
  bot.use(makeAuthMiddleware(cfg.allowedTgId, db));

  const pending = new Map<number, PendingTask>();
  const userModels = new Map<number, 'sonnet' | 'opus'>();

  // --- Commands ---

  bot.command('start', (ctx) => ctx.reply(
    'Forge Dev Station готова.\n\n' +
    '/new — новая задача\n' +
    '/tasks — активные задачи\n' +
    '/repos — список проектов\n' +
    '/model — выбрать модель\n' +
    '/new_project <name> — создать проект\n' +
    '/clone <user/repo> — клонировать с GitHub\n' +
    '/add_repo <path> [name] — добавить существующий'
  ));

  bot.command('repos', (ctx) => {
    const list = resolver.list();
    if (list.length === 0) return ctx.reply('Нет проектов. /add_repo <path>');
    return ctx.reply('Выбери проект:', projectKeyboard(list));
  });

  bot.command('tasks', (ctx) => {
    const active = getActiveTasks(db, ctx.from!.id);
    if (active.length === 0) return ctx.reply('Нет активных задач.');
    return ctx.reply('Активные задачи:', activeTasksKeyboard(active));
  });

  bot.command('model', (ctx) => {
    const current = userModels.get(ctx.from!.id) ?? cfg.defaultModel;
    return ctx.reply('Модель:', modelKeyboard(current));
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

  bot.command('new_project', async (ctx) => {
    const name = ctx.message.text.replace(/^\/new_project\s*/, '').trim();
    if (!name) return ctx.reply('Формат: /new_project <name>');
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) return ctx.reply('Имя: только буквы, цифры, - и _');
    const projectPath = path.join(PROJECTS_DIR, name);
    try {
      const { spawn } = await import('node:child_process');
      await fs.mkdirp(projectPath);
      await new Promise<void>((resolve, reject) => {
        const p = spawn('git', ['init'], { cwd: projectPath });
        p.on('close', (code) => code === 0 ? resolve() : reject(new Error('git init failed')));
      });
      const t = await resolver.addRepo(projectPath, name);
      return ctx.reply('Создан ' + t.name + ' в ' + projectPath);
    } catch (err) {
      return ctx.reply('Ошибка: ' + (err instanceof Error ? err.message : String(err)));
    }
  });

  bot.command('clone', async (ctx) => {
    const repo = ctx.message.text.replace(/^\/clone\s*/, '').trim();
    if (!repo) return ctx.reply('Формат: /clone user/repo');
    const name = repo.includes('/') ? repo.split('/').pop()! : repo;
    const projectPath = path.join(PROJECTS_DIR, name);
    try {
      await ctx.reply('Клонирую ' + repo + '...');
      const { spawn } = await import('node:child_process');
      await new Promise<void>((resolve, reject) => {
        const p = spawn('gh', ['repo', 'clone', repo, projectPath], { stdio: ['ignore', 'pipe', 'pipe'] });
        p.on('close', (code) => code === 0 ? resolve() : reject(new Error('clone failed')));
      });
      const t = await resolver.addRepo(projectPath, name);
      return ctx.reply('Клонирован ' + t.name + ' в ' + projectPath);
    } catch (err) {
      return ctx.reply('Ошибка: ' + (err instanceof Error ? err.message : String(err)));
    }
  });

  // --- Callback queries ---

  bot.action(/^select_project:(.+)$/, async (ctx) => {
    const name = ctx.match[1]!;
    const tgId = ctx.from!.id;
    const p = pending.get(tgId);
    if (!p) return ctx.answerCbQuery('Нет ожидающей задачи');
    p.projectName = name;
    await ctx.answerCbQuery(`Проект: ${name}`);
    await ctx.editMessageReplyMarkup(undefined);
    await startTask(ctx, tgId, p);
    pending.delete(tgId);
  });

  bot.action('new_project_flow', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply('\u041a\u0430\u043a \u0441\u043e\u0437\u0434\u0430\u0442\u044c \u043f\u0440\u043e\u0435\u043a\u0442?', Markup.inlineKeyboard([
      [Markup.button.callback('\u2795 \u041f\u0443\u0441\u0442\u043e\u0439 \u043f\u0440\u043e\u0435\u043a\u0442', 'create_empty_project')],
      [Markup.button.callback('\ud83d\udce5 \u041a\u043b\u043e\u043d\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u0441 GitHub', 'clone_from_github')],
    ]));
  });

  bot.action('create_empty_project', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply('\u041d\u0430\u043f\u0438\u0448\u0438 \u0438\u043c\u044f \u043f\u0440\u043e\u0435\u043a\u0442\u0430 (\u043b\u0430\u0442\u0438\u043d\u0438\u0446\u0430, \u0446\u0438\u0444\u0440\u044b, -)');
    pending.set(ctx.from!.id, { prompt: '__create_project__', model: userModels.get(ctx.from!.id) ?? cfg.defaultModel, target: 'server' });
  });

  bot.action('clone_from_github', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply('\u041d\u0430\u043f\u0438\u0448\u0438 user/repo (\u043d\u0430\u043f\u0440\u0438\u043c\u0435\u0440 avsmolentsev-tech/myapp)');
    pending.set(ctx.from!.id, { prompt: '__clone_repo__', model: userModels.get(ctx.from!.id) ?? cfg.defaultModel, target: 'server' });
  });

    bot.action(/^model:(sonnet|opus)$/, async (ctx) => {
    const model = ctx.match[1] as 'sonnet' | 'opus';
    userModels.set(ctx.from!.id, model);
    await ctx.answerCbQuery(`Модель: ${model}`);
    await ctx.editMessageText('Модель:', modelKeyboard(model));
  });

  bot.action(/^plan:approve:(\d+)$/, async (ctx) => {
    const taskId = Number(ctx.match[1]);
    await ctx.answerCbQuery('Approved!');
    await ctx.editMessageReplyMarkup(undefined);
    await executeTask(ctx, taskId);
  });

  bot.action(/^plan:edit:(\d+)$/, async (ctx) => {
    const taskId = Number(ctx.match[1]);
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup(undefined);
    addEvent(db, taskId, 'plan_edit_requested');
    await ctx.reply(`✏️ Задача #${taskId}: напиши, что изменить в плане.`);
    pending.set(ctx.from!.id, {
      prompt: `__replan__:${taskId}`,
      model: userModels.get(ctx.from!.id) ?? cfg.defaultModel,
      target: 'server',
    });
  });

  bot.action(/^plan:cancel:(\d+)$/, async (ctx) => {
    const taskId = Number(ctx.match[1]);
    taskMgr.transition(taskId, 'REJECTED');
    await ctx.answerCbQuery('Отменено');
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply(`🚫 Задача #${taskId} отменена.`);
  });

  bot.action(/^action:push:(\d+)$/, async (ctx) => {
    const taskId = Number(ctx.match[1]);
    const task = getTask(db, taskId);
    if (!task?.worktree_path) return ctx.answerCbQuery('Нет worktree');
    await ctx.answerCbQuery('Pushing...');
    try {
      const { spawn } = await import('node:child_process');
      await new Promise<void>((resolve, reject) => {
        const p = spawn('git', ['push', 'origin', task.branch!], { cwd: task.worktree_path! });
        p.on('close', (code) => code === 0 ? resolve() : reject(new Error(`push exit ${code}`)));
      });
      await ctx.reply(`✅ Задача #${taskId}: pushed to ${task.branch}`);
    } catch (err) {
      await ctx.reply(`❌ Push failed: ${err instanceof Error ? err.message : err}`);
    }
  });

  bot.action(/^action:rollback:(\d+)$/, async (ctx) => {
    const taskId = Number(ctx.match[1]);
    const task = getTask(db, taskId);
    if (!task?.worktree_path) return ctx.answerCbQuery('Нет worktree');
    await ctx.answerCbQuery('Rolling back...');
    try {
      const { spawn } = await import('node:child_process');
      await new Promise<void>((resolve, reject) => {
        const p = spawn('git', ['revert', '--no-edit', 'HEAD'], { cwd: task.worktree_path! });
        p.on('close', (code) => code === 0 ? resolve() : reject(new Error(`revert exit ${code}`)));
      });
      await ctx.reply(`↩ Задача #${taskId}: reverted`);
    } catch (err) {
      await ctx.reply(`❌ Rollback failed: ${err instanceof Error ? err.message : err}`);
    }
  });

  bot.action(/^action:continue:(\d+)$/, async (ctx) => {
    const taskId = Number(ctx.match[1]);
    await ctx.answerCbQuery();
    await ctx.reply(`💬 Задача #${taskId}: напиши дополнительную инструкцию.`);
    pending.set(ctx.from!.id, {
      prompt: `__continue__:${taskId}`,
      model: userModels.get(ctx.from!.id) ?? cfg.defaultModel,
      target: 'server',
    });
  });

  bot.action(/^action:retry:(\d+)$/, async (ctx) => {
    const taskId = Number(ctx.match[1]);
    await ctx.answerCbQuery('Retrying...');
    await ctx.editMessageReplyMarkup(undefined);
    await executeTask(ctx, taskId);
  });

  bot.action(/^action:stop:(\d+)$/, async (ctx) => {
    const taskId = Number(ctx.match[1]);
    const stopped = taskMgr.stopTask(taskId);
    await ctx.answerCbQuery(stopped ? 'Остановлено' : 'Не запущено');
  });

  bot.action(/^action:cancel:(\d+)$/, async (ctx) => {
    const taskId = Number(ctx.match[1]);
    taskMgr.stopTask(taskId);
    try { taskMgr.transition(taskId, 'REJECTED'); } catch {}
    await ctx.answerCbQuery('Отменено');
    await ctx.editMessageReplyMarkup(undefined);
  });

  // --- Text handler ---

  bot.on('text', async (ctx) => {
    const tgId = ctx.from!.id;
    const text = ctx.message.text;
    if (text.startsWith('/')) return;

    const p = pending.get(tgId);
    if (p?.prompt === '__create_project__') {
      pending.delete(tgId);
      const name = text.trim();
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        return ctx.reply('\u2757 \u0418\u043c\u044f: \u0442\u043e\u043b\u044c\u043a\u043e \u043b\u0430\u0442\u0438\u043d\u0438\u0446\u0430, \u0446\u0438\u0444\u0440\u044b, - \u0438 _');
      }
      const projectPath = path.join(PROJECTS_DIR, name);
      try {
        const { spawn } = await import('node:child_process');
        await fs.mkdirp(projectPath);
        await new Promise<void>((resolve, reject) => {
          const p = spawn('git', ['init'], { cwd: projectPath });
          p.on('close', (code) => code === 0 ? resolve() : reject(new Error('git init failed')));
        });
        const t = await resolver.addRepo(projectPath, name);
        return ctx.reply('\u2705 \u0421\u043e\u0437\u0434\u0430\u043d ' + t.name + ' \u0432 ' + projectPath);
      } catch (err) {
        return ctx.reply('\u274c ' + (err instanceof Error ? err.message : String(err)));
      }
    }
    if (p?.prompt === '__clone_repo__') {
      pending.delete(tgId);
      const repo = text.trim();
      const name = repo.includes('/') ? repo.split('/').pop()! : repo;
      const projectPath = path.join(PROJECTS_DIR, name);
      try {
        await ctx.reply('\ud83d\udce5 \u041a\u043b\u043e\u043d\u0438\u0440\u0443\u044e ' + repo + '...');
        const { spawn } = await import('node:child_process');
        await new Promise<void>((resolve, reject) => {
          const p = spawn('gh', ['repo', 'clone', repo, projectPath], { stdio: ['ignore', 'pipe', 'pipe'] });
          p.on('close', (code) => code === 0 ? resolve() : reject(new Error('clone failed')));
        });
        const t = await resolver.addRepo(projectPath, name);
        return ctx.reply('\u2705 \u041a\u043b\u043e\u043d\u0438\u0440\u043e\u0432\u0430\u043d ' + t.name);
      } catch (err) {
        return ctx.reply('\u274c ' + (err instanceof Error ? err.message : String(err)));
      }
    }
        if (p?.prompt.startsWith('__replan__:')) {
      const taskId = Number(p.prompt.split(':')[1]);
      pending.delete(tgId);
      const task = getTask(db, taskId);
      if (!task) return ctx.reply('Задача не найдена.');
      taskMgr.transition(taskId, 'PLANNING');
      await planTask(ctx, taskId, `${task.prompt}\n\nУточнение: ${text}`);
      return;
    }
    if (p?.prompt.startsWith('__continue__:')) {
      const taskId = Number(p.prompt.split(':')[1]);
      pending.delete(tgId);
      const task = getTask(db, taskId);
      if (!task) return ctx.reply('Задача не найдена.');
      updateTask(db, taskId, { state: 'RUNNING' });
      await runClaudeInWorktree(ctx, taskId, text);
      return;
    }

    if (!taskMgr.canAcceptTask()) {
      return ctx.reply(`⚠️ Уже ${cfg.maxConcurrentTasks} задач работают. Дождись завершения или /tasks для списка.`);
    }

    const model = userModels.get(tgId) ?? cfg.defaultModel;
    const projects = resolver.list();

    if (projects.length === 0) {
      return ctx.reply('Нет проектов. /add_repo <path>');
    }

    if (projects.length === 1) {
      const newPending: PendingTask = { prompt: text, model, target: 'server', projectName: projects[0]!.name };
      await startTask(ctx, tgId, newPending);
    } else {
      pending.set(tgId, { prompt: text, model, target: 'server' });
      await ctx.reply('🤖 Проект?', projectKeyboard(projects));
    }
  });

  // --- Voice ---

  bot.on(message('voice'), async (ctx) => {
    try {
      await ctx.reply('🎤 Транскрибирую...');
      const link = await ctx.telegram.getFileLink(ctx.message.voice.file_id);
      const res = await fetch(link.href);
      const buf = Buffer.from(await res.arrayBuffer());
      const text = await transcribe(buf, 'voice.ogg');
      if (!text.trim()) { await ctx.reply('⚠️ пусто'); return; }
      await ctx.reply(`📝 ${text.slice(0, 500)}${text.length > 500 ? '…' : ''}`);
      const fakeMessage = { ...(ctx.message as any), text };
      await bot.handleUpdate({ update_id: 0, message: fakeMessage } as any);
    } catch (err) {
      await ctx.reply(`❌ ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // --- Photo ---

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
      const prompt = `Скриншот: ${outPath}\n\n${ctx.message.caption ?? 'Проанализируй.'}`;
      const fakeMessage = { ...(ctx.message as any), text: prompt };
      await bot.handleUpdate({ update_id: 0, message: fakeMessage } as any);
    } catch (err) {
      await ctx.reply(`❌ ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // --- Document ---

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
      const prompt = `Файл: ${outPath}\n\n${ctx.message.caption ?? 'Посмотри и действуй.'}`;
      const fakeMessage = { ...(ctx.message as any), text: prompt };
      await bot.handleUpdate({ update_id: 0, message: fakeMessage } as any);
    } catch (err) {
      await ctx.reply(`❌ ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // --- Core task flow ---

  async function startTask(ctx: Context, tgId: number, p: PendingTask): Promise<void> {
    const project = resolver.get(p.projectName!);
    if (!project) { await ctx.reply(`Проект ${p.projectName} не найден.`); return; }

    const task = createTask(db, {
      user_id: tgId,
      project_name: p.projectName!,
      prompt: p.prompt,
      model: p.model,
      target: p.target,
    });

    await ctx.reply(`🚀 Задача #${task.id} · ${task.project_name} (${task.model})`);

    if (project.type === 'git') {
      try {
        const wt = await createWorktree(project.path, task.id);
        updateTask(db, task.id, { worktree_path: wt.worktreePath, branch: wt.branch });
      } catch (err) {
        await ctx.reply(`❌ Worktree failed: ${err instanceof Error ? err.message : err}`);
        taskMgr.transition(task.id, 'FAILED' as TaskState);
        return;
      }
    }

    await planTask(ctx, task.id, p.prompt);
  }

  async function planTask(ctx: Context, taskId: number, prompt: string): Promise<void> {
    const task = getTask(db, taskId)!;
    const project = resolver.get(task.project_name)!;
    taskMgr.transition(taskId, 'PLANNING');

    const cwd = task.worktree_path ?? project.path;
    const planPrompt = buildPlanPrompt(prompt);

    const runner = new ClaudeRunner({
      bin: cfg.claudeBin,
      args: ['-p', '--permission-mode', 'bypassPermissions', '--model', MODEL_FLAG(task.model as 'sonnet' | 'opus')],
      cwd,
    });

    try {
      let output = '';
      const result = await runner.run(planPrompt, (chunk) => { output += chunk; });

      if (result.exitCode !== 0) {
        taskMgr.transition(taskId, 'FAILED');
        await ctx.reply(`❌ Задача #${taskId}: planning failed (exit ${result.exitCode})`);
        return;
      }

      const plan = extractPlan(output) ?? output.slice(-2000);
      updateTask(db, taskId, { plan });
      taskMgr.transition(taskId, 'PLAN_GATE');

      const msg = formatPlan(taskId, task.project_name, plan);
      for (const chunk of chunkForTelegram(msg)) {
        await ctx.reply(chunk);
      }
      await ctx.reply('Утвердить план?', planGateKeyboard(taskId));
    } catch (err) {
      taskMgr.transition(taskId, 'FAILED');
      await ctx.reply(`❌ Задача #${taskId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  async function executeTask(ctx: Context, taskId: number): Promise<void> {
    const task = getTask(db, taskId)!;
    taskMgr.transition(taskId, 'RUNNING');
    const prompt = buildExecutePrompt(task.prompt, task.plan ?? '');
    await runClaudeInWorktree(ctx, taskId, prompt);
  }

  async function runClaudeInWorktree(ctx: Context, taskId: number, prompt: string): Promise<void> {
    const task = getTask(db, taskId)!;
    const project = resolver.get(task.project_name)!;
    const cwd = task.worktree_path ?? project.path;

    const runner = new ClaudeRunner({
      bin: cfg.claudeBin,
      args: ['-p', '--permission-mode', 'bypassPermissions', '--model', MODEL_FLAG(task.model as 'sonnet' | 'opus')],
      cwd,
    });

    const tmuxSession = `forge-task-${taskId}`;
    taskMgr.registerRunner(taskId, runner, tmuxSession);

    await ctx.reply(`⏳ Задача #${taskId} работает...`, workingKeyboard(taskId));

    try {
      let output = '';
      const result = await runner.run(prompt, (chunk) => { output += chunk; });

      taskMgr.unregisterRunner(taskId);

      if (result.exitCode !== 0) {
        updateTask(db, taskId, { result_summary: output.slice(-1000) });
        taskMgr.transition(taskId, 'FAILED');
        await ctx.reply(formatFailed(getTask(db, taskId)!), failedKeyboard(taskId));
        return;
      }

      const summary = extractSummary(output) ?? 'Выполнено.';
      updateTask(db, taskId, { result_summary: summary });

      if (task.worktree_path) {
        try {
          const diffStat = await getWorktreeDiffStat(task.worktree_path);
          updateTask(db, taskId, { diff_stat: JSON.stringify(diffStat.files) });
        } catch {}
      }

      taskMgr.transition(taskId, 'VERIFYING');
      const verify = await runVerify(cwd, cfg.verifyCommand);
      updateTask(db, taskId, { test_result: formatVerifyResult(verify) });

      if (verify.passed) {
        taskMgr.transition(taskId, 'DONE');
        const report = formatReport(getTask(db, taskId)!);
        for (const chunk of chunkForTelegram(report)) {
          await ctx.reply(chunk);
        }
        await ctx.reply('Действия:', doneKeyboard(taskId, cfg.miniappUrl));
      } else {
        taskMgr.transition(taskId, 'FAILED');
        await ctx.reply(formatFailed(getTask(db, taskId)!), failedKeyboard(taskId));
      }
    } catch (err) {
      taskMgr.unregisterRunner(taskId);
      updateTask(db, taskId, { result_summary: err instanceof Error ? err.message : String(err) });
      try { taskMgr.transition(taskId, 'FAILED'); } catch {}
      await ctx.reply(`❌ Задача #${taskId}: ${err instanceof Error ? err.message : err}`, failedKeyboard(taskId));
    }
  }

  bot.catch((err) => console.error('[forge] handler error:', err));
  await bot.launch();
  console.log('[forge] bot started');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
