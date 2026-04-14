import { SessionManager } from '../src/session.js';

jest.useFakeTimers();

test('get creates new session with default model', () => {
  const mgr = new SessionManager({ timeoutMs: 1000, defaultModel: 'sonnet' });
  const s = mgr.get(42);
  expect(s.tgId).toBe(42);
  expect(s.model).toBe('sonnet');
  expect(s.activeTarget).toBeUndefined();
});

test('get returns same session on second call', () => {
  const mgr = new SessionManager({ timeoutMs: 1000, defaultModel: 'sonnet' });
  const a = mgr.get(42);
  a.model = 'opus';
  const b = mgr.get(42);
  expect(b.model).toBe('opus');
});

test('inactivity timer closes session', () => {
  const mgr = new SessionManager({ timeoutMs: 1000, defaultModel: 'sonnet' });
  mgr.get(42);
  mgr.touch(42);
  jest.advanceTimersByTime(1500);
  expect(mgr.has(42)).toBe(false);
});

test('touch resets the timer', () => {
  const mgr = new SessionManager({ timeoutMs: 1000, defaultModel: 'sonnet' });
  mgr.get(42);
  mgr.touch(42);
  jest.advanceTimersByTime(500);
  mgr.touch(42);
  jest.advanceTimersByTime(700);
  expect(mgr.has(42)).toBe(true);
});

test('end removes session', () => {
  const mgr = new SessionManager({ timeoutMs: 1000, defaultModel: 'sonnet' });
  mgr.get(42);
  mgr.end(42);
  expect(mgr.has(42)).toBe(false);
});
