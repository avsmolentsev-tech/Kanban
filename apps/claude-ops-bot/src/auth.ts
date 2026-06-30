import type { Context, MiddlewareFn } from 'telegraf';
import type Database from 'better-sqlite3';
import { ensureUser } from './db.js';

export function makeAuthMiddleware(allowedTgId: number, db: Database.Database): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const id = ctx.from?.id;
    if (id !== allowedTgId) {
      if (id != null) await ctx.reply('not authorized');
      return;
    }
    const name = ctx.from?.first_name ?? ctx.from?.username ?? String(id);
    ensureUser(db, id, name);
    return next();
  };
}
