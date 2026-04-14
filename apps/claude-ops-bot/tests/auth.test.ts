import { makeAuthMiddleware } from '../src/auth.js';

function fakeCtx(fromId: number | undefined) {
  const replies: string[] = [];
  return {
    from: fromId == null ? undefined : { id: fromId },
    reply: (t: string) => { replies.push(t); return Promise.resolve(); },
    _replies: replies,
  };
}

test('passes when id matches', async () => {
  const mw = makeAuthMiddleware(42);
  const ctx: any = fakeCtx(42);
  let nextCalled = false;
  await mw(ctx, async () => { nextCalled = true; });
  expect(nextCalled).toBe(true);
  expect(ctx._replies).toHaveLength(0);
});

test('blocks when id differs', async () => {
  const mw = makeAuthMiddleware(42);
  const ctx: any = fakeCtx(100);
  let nextCalled = false;
  await mw(ctx, async () => { nextCalled = true; });
  expect(nextCalled).toBe(false);
  expect(ctx._replies[0]).toMatch(/not authorized/i);
});

test('blocks when id missing', async () => {
  const mw = makeAuthMiddleware(42);
  const ctx: any = fakeCtx(undefined);
  let nextCalled = false;
  await mw(ctx, async () => { nextCalled = true; });
  expect(nextCalled).toBe(false);
});
