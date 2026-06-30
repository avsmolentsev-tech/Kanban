import Fastify from 'fastify';
import cors from '@fastify/cors';
import type Database from 'better-sqlite3';
import type { OpsConfig } from './config.js';
import { getTask, getRecentTasks, getEvents } from './db.js';
import { getWorktreeDiff } from './task-manager.js';
import { authHook } from './miniapp-auth.js';
import { ProjectResolver } from './project-resolver.js';
import * as path from 'node:path';

export async function startApi(cfg: OpsConfig, db: Database.Database): Promise<void> {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: cfg.miniappUrl });

  app.addHook('onRequest', authHook(cfg.telegramToken, cfg.allowedTgId));

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

  await app.listen({ port: cfg.fastifyPort, host: '127.0.0.1' });
  console.log(`[forge] API listening on 127.0.0.1:${cfg.fastifyPort}`);
}
