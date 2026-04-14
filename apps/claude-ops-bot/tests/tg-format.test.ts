import { chunkForTelegram } from '../src/tg-format.js';

test('short text yields one chunk', () => {
  expect(chunkForTelegram('hello')).toEqual(['hello']);
});

test('long text split on newline boundary', () => {
  const long = 'a'.repeat(2000) + '\n' + 'b'.repeat(2000);
  const chunks = chunkForTelegram(long, 3500);
  // 4001 chars with a newline at pos 2000 — split at newline within 200 of limit
  expect(chunks.length).toBeGreaterThanOrEqual(2);
  chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(3500));
  expect(chunks.join('')).toBe(long);
});

test('very long text splits into 3500-char chunks', () => {
  const long = 'a'.repeat(10_000);
  const chunks = chunkForTelegram(long, 3500);
  expect(chunks.length).toBeGreaterThanOrEqual(3);
  chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(3500));
  expect(chunks.join('')).toBe(long);
});

test('splits prefer newline within 200 chars of limit', () => {
  const line = 'a'.repeat(3000);
  const text = `${line}\n${line}\n${line}`;
  const chunks = chunkForTelegram(text, 3500);
  chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(3500));
});
