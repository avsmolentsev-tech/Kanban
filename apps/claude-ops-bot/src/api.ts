import Fastify from 'fastify';
import cors from '@fastify/cors';
import type Database from 'better-sqlite3';
import type { OpsConfig } from './config.js';
import { getTask, getRecentTasks, getEvents, createTask } from './db.js';
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
    return resolver.list();
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

  await app.listen({ port: cfg.fastifyPort, host: '127.0.0.1' });
  console.log(`[forge] API listening on 127.0.0.1:${cfg.fastifyPort}`);
}
