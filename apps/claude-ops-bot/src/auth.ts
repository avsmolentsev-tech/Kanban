import type { Context, MiddlewareFn } from 'telegraf';

export function makeAuthMiddleware(allowedTgId: number): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const id = ctx.from?.id;
    if (id !== allowedTgId) {
      if (id != null) await ctx.reply('not authorized');
      return;
    }
    return next();
  };
}
