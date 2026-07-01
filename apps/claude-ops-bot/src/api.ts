import Fastify from 'fastify';
import cors from '@fastify/cors';
import type Database from 'better-sqlite3';
import type { OpsConfig } from './config.js';
import { getTask, getRecentTasks, getEvents, createTask, addChatMessage, getChatHistory, clearChatHistory } from './db.js';
import { getWorktreeDiff } from './task-manager.js';
import { authHook } from './miniapp-auth.js';
import { ProjectResolver } from './project-resolver.js';
import * as path from 'node:path';

export async function startApi(cfg: OpsConfig, db: Database.Database): Promise<void> {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: cfg.miniappUrl });

  // Auth temporarily relaxed - allow requests without initData for MiniApp testing
  app.addHook("onRequest", async (request, reply) => {
    const initData = request.headers["x-telegram-init-data"] as string;
    if (initData) {
      const { validateInitData } = await import("./miniapp-auth.js");
      const { valid, userId } = validateInitData(initData, cfg.telegramToken);
      (request as any).tgUserId = valid ? userId : cfg.allowedTgId;
    } else {
      (request as any).tgUserId = cfg.allowedTgId;
    }
  });

  app.get('/api/me', async (request) => {
    return { userId: (request as any).tgUserId };
  });

  app.get('/api/projects', async () => {
    const resolver = new ProjectResolver(path.join(cfg.stateDir, 'repos.json'));
    await resolver.load();
    return resolver.list().map(p => ({ name: p.name, path: p.path, type: p.type, hidden: !!p.hidden }));
  });

  // Toggle project hidden status
  app.post<{ Params: { name: string }; Body: { hidden: boolean } }>('/api/projects/:name/visibility', async (request, reply) => {
    const { name } = request.params;
    const { hidden } = request.body as any;
    const resolver = new ProjectResolver(path.join(cfg.stateDir, 'repos.json'));
    await resolver.load();
    const project = resolver.get(name);
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    resolver.setHidden(name, hidden);
    return { ok: true, name, hidden };
  });

    app.get('/api/tasks', async (request) => {
    const userId = (request as any).tgUserId as number;
    return getRecentTasks(db, userId, 50);
  });

  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) => {
    const id = Number(request.params.id);
    const task = getTask(db, id);
    if (!task) return reply.code(404).send({ error: 'Not found' });
    const events = getEvents(db, id);
    return { ...task, events };
  });

  app.get<{ Params: { id: string } }>('/api/tasks/:id/diff', async (request, reply) => {
    const id = Number(request.params.id);
    const task = getTask(db, id);
    if (!task?.worktree_path) return reply.code(404).send({ error: 'No worktree' });
    try {
      const diff = await getWorktreeDiff(task.worktree_path);
      return { diff, task };
    } catch (err) {
      return reply.code(500).send({ error: 'Failed to get diff' });
    }
  });


  // List files in project directory
  app.get<{ Params: { name: string }; Querystring: { path?: string } }>('/api/projects/:name/files', async (request, reply) => {
    const resolver = new ProjectResolver(path.join(cfg.stateDir, 'repos.json'));
    await resolver.load();
    const project = resolver.get(request.params.name);
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    const subpath = (request.query as any).path || '';
    const fullPath = path.join(project.path, subpath);
    if (!fullPath.startsWith(project.path)) return reply.code(403).send({ error: 'Forbidden' });
    const { readdirSync } = await import('node:fs');
    const entries = readdirSync(fullPath, { withFileTypes: true });
    const items = entries
      .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => ({ name: e.name, isDirectory: e.isDirectory() }))
      .sort((a, b) => (b.isDirectory ? 1 : 0) - (a.isDirectory ? 1 : 0) || a.name.localeCompare(b.name));
    return items;
  });

  // Read file content
  app.get<{ Params: { name: string }; Querystring: { path: string } }>('/api/projects/:name/file', async (request, reply) => {
    const resolver = new ProjectResolver(path.join(cfg.stateDir, 'repos.json'));
    await resolver.load();
    const project = resolver.get(request.params.name);
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    const filePath = path.join(project.path, (request.query as any).path || '');
    if (!filePath.startsWith(project.path)) return reply.code(403).send({ error: 'Forbidden' });
    const { existsSync, readFileSync } = await import('node:fs');
    if (!existsSync(filePath)) return reply.code(404).send({ error: 'File not found' });
    const content = readFileSync(filePath, 'utf-8');
    return { content, path: (request.query as any).path };
  });

  // Create task from MiniApp
  app.post<{ Body: { project_name: string; prompt: string; model?: string } }>('/api/tasks', async (request, reply) => {
    const userId = (request as any).tgUserId as number;
    const { project_name, prompt, model } = request.body as any;
    if (!project_name || !prompt) return reply.code(400).send({ error: 'project_name and prompt required' });
    const task = createTask(db, { user_id: userId, project_name, prompt, model: model || 'sonnet', target: 'server' });
    return task;
  });


  // --- Chat endpoints ---

  // Get chat history
  app.get('/api/chat', async (request) => {
    const userId = (request as any).tgUserId as number;
    return getChatHistory(db, userId);
  });

  // Send chat message and get Claude response
  app.post<{ Body: { message: string; project_name?: string } }>('/api/chat', async (request, reply) => {
    const userId = (request as any).tgUserId as number;
    const { message, project_name } = request.body as any;
    if (!message) return reply.code(400).send({ error: 'message required' });

    // Save user message
    addChatMessage(db, { user_id: userId, project_name: project_name || null, role: 'user', content: message });

    // Get recent history for context
    const history = getChatHistory(db, userId, 20);

    // Build context prompt with history
    const resolver = new ProjectResolver(path.join(cfg.stateDir, 'repos.json'));
    await resolver.load();

    const contextLines: string[] = [];
    if (project_name) {
      contextLines.push('Проект: ' + project_name);
      const project = resolver.get(project_name);
      if (project) contextLines.push('Путь: ' + project.path);
    }
    contextLines.push('');
    contextLines.push('История диалога:');
    for (const msg of history.slice(-10)) {
      const prefix = msg.role === 'user' ? 'Пользователь' : 'Ассистент';
      contextLines.push(prefix + ': ' + msg.content);
    }
    contextLines.push('');
    contextLines.push('Ответь на последнее сообщение пользователя.');

    const fullPrompt = contextLines.join('\n');

    // Determine cwd
    let cwd = '/root/projects';
    if (project_name) {
      const project = resolver.get(project_name);
      if (project) cwd = project.path;
    }

    // Run Claude
    const { ClaudeRunner } = await import('./claude-runner.js');
    const runner = new ClaudeRunner({
      bin: cfg.claudeBin,
      args: ['-p', '--dangerously-skip-permissions', '--model', 'claude-sonnet-4-6'],
      cwd,
    });

    try {
      let output = '';
      const result = await runner.run(fullPrompt, (chunk: string) => { output += chunk; });
      const cleanOutput = output.trim();
      addChatMessage(db, { user_id: userId, project_name: project_name || null, role: 'assistant', content: cleanOutput });
      return { role: 'assistant', content: cleanOutput };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      addChatMessage(db, { user_id: userId, project_name: project_name || null, role: 'assistant', content: 'Ошибка: ' + errMsg });
      return { role: 'assistant', content: 'Ошибка: ' + errMsg };
    }
  });

  // Clear chat
  app.delete('/api/chat', async (request) => {
    const userId = (request as any).tgUserId as number;
    clearChatHistory(db, userId);
    return { ok: true };
  });

  await app.listen({ port: cfg.fastifyPort, host: '127.0.0.1' });
  console.log(`[forge] API listening on 127.0.0.1:${cfg.fastifyPort}`);
}
